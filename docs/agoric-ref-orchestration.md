# Agoric Orchestration Reference

Source: agoric-sdk `packages/orchestration/` at `9712d748a` (2026-09-17), docs.agoric.com, dapp-orchestration-basics
Retrieved: March 2026. Refreshed: 17 September 2026 (PactPay framing removed; code re-read from the current SDK clone at `~/AAT/upstream/agoric-sdk`)

Changes since the March 2026 version are marked **[updated]**. The largest: `send-anywhere` now supports CCTP to EVM chains via a Noble account, flows are bound with `orchestrate()` per flow rather than a single `orchestrateAll()`, chain lookups in flows go through `chainHub`, and chain identity is CAIP-2 (`namespace` + `reference`) rather than Cosmos-only `chainId`.

---

## What Orchestration does

The Orchestration API lets a Zoe contract control accounts on other chains, move assets over IBC or CCTP, and coordinate multi-step operations that span many blocks. Three properties make it work:

- Remote account control via Interchain Accounts (ICA) on Cosmos chains, and via a Noble ICA plus CCTP for EVM destinations.
- Async flows with durable, multi-block execution: a flow can `await` a response that arrives blocks or days later and survives contract upgrade through deterministic replay (`packages/async-flow/docs/async-flow-states.md`: `Running`, `Sleeping`, `Replaying`, `Failed`, `Done`).
- The on-chain timer service for scheduled operations.

---

## Contract structure

An orchestration contract is two files.

**Contract file** (`*.contract.js`): exports a `contract(zcf, privateArgs, zone, tools)` function and `export const start = withOrchestration(contract, opts)`. It registers chains and assets, binds flows to their context, and builds the facets as zone exos.

**Flows file** (`*.flows.js`): plain async functions of the form `(orch, ctx, seat, offerArgs) => …`. They contain the business logic and run as async-flow guests. They must be deterministic and replay-safe: no `E()` on orchestration accounts, no reading durable state after an `await` (see `agoric-devnet-sharp-edges.md` items 1 to 5).

**[updated]** Tools passed to `contract` by `withOrchestration`: `{ chainHub, orchestrate, orchestrateAll, vowTools, zoeTools }`. Both binding styles exist in the tree:

```javascript
// per flow (send-anywhere, current style)
const sendAnywhere = orchestrate('sendAnywhere', { log, chainHub, sharedLocalAccountP, zoeTools }, sendIt);

// all flows at once (auto-stake-it, axelar-gmp)
const { makeAccounts } = orchestrateAll(flows, { chainHub, vowTools });
```

The first argument to `orchestrate` is a durable name used to "prepare" the flow across upgrades; changing it is a breaking change to a deployed instance.

**[updated]** `withOrchestration(contract, { publishAccountInfo: true })` opts the contract into publishing account info to vstorage; it also determines which orchestration powers the CoreEval permit must grant.

---

## Key APIs (verified against `orchestration-api.ts` and `cosmos-api.ts`)

### Orchestrator (`orch`) and Chain

```javascript
const agoric = await orch.getChain('agoric');
const osmosis = await orch.getChain('osmosis');
const account = await osmosis.makeAccount();       // ICA on osmosis
const info = await osmosis.getChainInfo();         // { namespace, reference, chainId, ... }
const assets = await agoric.getVBankAssetInfo();   // registered denoms -> brands
const denomInfo = orch.getDenomInfo(denom);        // brand, base chain, etc.
// chain.query(...) only where chainInfo.icqEnabled is true
```

Do not call `orch.getChain('agoric')` during contract start; it hangs on devnet (sharp edges item 7). Call it inside flows.

### ChainHub (contract side and, as a guest interface, in flows)

**[updated]** `chainHub` is the registry of chains, connections and denoms. Flows now look up chain info through it rather than through `orch.getChain(name).getChainInfo()`:

```javascript
const info = await chainHub.getChainInfo(chainName);
const [agoricInfo, remoteInfo, connection] = await chainHub.getChainsAndConnection('agoric', chainName);
connection.counterparty || Fail`No IBC connection to ${chainName}`;
```

Contract side, at start: `registerChainsAndAssets(chainHub, zcf.getTerms().brands, privateArgs.chainInfo, privateArgs.assetInfo)` populates it from private args. `prepareChainHubAdmin(zone, chainHub)` returns a creator facet with `registerChain` / `registerAsset` for later additions.

### Chain identity

**[updated]** `ChainInfo` is CAIP-2 shaped: `namespace` (`'cosmos'`, `'eip155'`, …) and `reference` (`'agoric-3'`, `'1'`, …). Cosmos chains additionally carry `chainId`. EVM destinations reachable via CCTP carry `cctpDestinationDomain`. Account identifiers are `AccountId = \`${namespace}:${reference}:${address}\``. Methods that take a destination accept `AccountIdArg = AccountId | CosmosChainAddress`.

```javascript
// CosmosChainAddress (still accepted for Cosmos destinations)
{ value: 'osmo1abc...', encoding: 'bech32', chainId: 'osmosis-1' }
// AccountId (required for non-Cosmos destinations)
'eip155:1:0xabc...'
```

### OrchestrationAccount (common to local and remote)

`getAddress()`, `getBalance(denom)`, `getBalances()`, `send(to, amount)`, `sendAll(to, amounts)`, `transfer(to, amount, opts)` (IBC transfer, or CCTP when the destination is an EVM `AccountId` and the account is on Noble), `transferSteps(amount, msg)`, `asContinuingOffer()`, `getPublicTopics()`.

### CosmosOrchestrationAccount (remote ICA)

Adds `delegate`, `undelegate`, `redelegate`, `withdrawReward`, `liquidStake`, `executeTx(msgs)`, `executeEncodedTx`, `deactivate()` / `reactivate()` (ICA channel lifecycle), and **[updated]** `depositForBurn(destAccountId, denomAmount)` for CCTP from a Noble account.

### LocalOrchestrationAccount (on Agoric)

Adds `deposit(payment)`, `withdraw(amount)`, `monitorTransfers(tap)` (IBC-hooks style tap on incoming transfers, used by auto-stake-it).

### ZoeTools

```javascript
const { localTransfer, withdrawToSeat } = zoeTools;
await localTransfer(seat, localAccount, give);     // Zoe seat -> local orchestration account
await withdrawToSeat(localAccount, seat, give);    // back to the seat, for rollback
```

---

## `send-anywhere` (annotated, current source)

The canonical example. It moves a single asset from an ERTP purse to an account on another chain, over IBC for Cosmos destinations or over CCTP for USDC to EVM destinations.

### Contract setup

```javascript
export const contract = async (zcf, privateArgs, zone, { chainHub, orchestrate, vowTools, zoeTools }) => {
  const creatorFacet = prepareChainHubAdmin(zone, chainHub);

  const logNode = E(privateArgs.storageNode).makeChildNode('log');
  const log = msg => vowTools.watch(E(logNode).setValue(msg));

  const makeLocalAccount = orchestrate('makeLocalAccount', {}, sharedFlows.makeLocalAccount);
  const makeNobleAccount = orchestrate('makeNobleAccountFlow', {}, makeNobleAccountFlow);

  const { brands } = zcf.getTerms();
  registerChainsAndAssets(chainHub, brands, privateArgs.chainInfo, privateArgs.assetInfo);

  // one-time durable initialisation; a vow, awaited inside flows
  const sharedLocalAccountP = zone.makeOnce('localAccount', () => makeLocalAccount());
  const nobleAccountP = zone.makeOnce('nobleAccount', () => makeNobleAccount());

  const sendAnywhere = orchestrate(
    'sendAnywhere',
    { log, chainHub, sharedLocalAccountP, nobleAccountP, USDC: brands.USDC, zoeTools },
    sendIt,
  );

  const publicFacet = zone.exo('Send PF',
    M.interface('Send PF', { makeSendInvitation: M.callWhen().returns(InvitationShape) }),
    { makeSendInvitation() {
        return zcf.makeInvitation(sendAnywhere, 'send', undefined,
          M.splitRecord({ give: SingleNatAmountRecord }));
    } });

  return { publicFacet, creatorFacet };
};
export const start = withOrchestration(contract, { publishAccountInfo: true });
```

`SingleNatAmountRecord = M.and(M.recordOf(M.string(), AnyNatAmountShape, { numPropertiesLimit: 1 }), M.not(harden({})))` guarantees exactly one asset in `give`.

### Flow: `sendIt(orch, ctx, seat, offerArgs)`

```javascript
mustMatch(offerArgs, harden({ chainName: M.scalar(), destAddr: M.string() }));
const { give } = seat.getProposal();
const [[_kw, amt]] = entries(give);
const denom = await denomForBrand(orch, amt.brand);          // via agoric.getVBankAssetInfo()
const info = await chainHub.getChainInfo(chainName);
const sharedLocalAccount = await sharedLocalAccountP;

const recoverFailedTransfer = async e => {
  await withdrawToSeat(sharedLocalAccount, seat, give);
  seat.fail(errorMsg);                                        // [updated] fail, not exit(msg)
  throw makeError(errorMsg);
};

if (info.namespace === 'cosmos') {
  const [, , connection] = await chainHub.getChainsAndConnection('agoric', chainName);
  connection.counterparty || Fail`No IBC connection to ${chainName}`;
  await localTransfer(seat, sharedLocalAccount, give);
  try {
    await sharedLocalAccount.transfer({ value: destAddr, encoding: 'bech32', chainId: info.chainId },
                                      { denom, value: amt.value });
  } catch (e) { return recoverFailedTransfer(e); }
} else if (amt.brand === USDC && 'cctpDestinationDomain' in info) {
  const nobleAccount = await nobleAccountP;
  await sharedLocalAccount.transfer(nobleAccount.getAddress(), { denom, value: amt.value });
  const destAccountId = `${info.namespace}:${info.reference}:${destAddr}`;
  try {
    await nobleAccount.depositForBurn(destAccountId, { denom, value: amt.value });
  } catch (e) {
    // try to bring funds back from Noble; if that also fails, a contract upgrade is needed
    …
    return recoverFailedTransfer(e);
  }
} else {
  Fail`There is currently support only for IBC and USDC transfers`;
}
seat.exit();
```

Things to copy from it: validate `offerArgs` with `mustMatch` at the top; read the proposal before any `await`; `localTransfer` only after the connection check; rollback with `withdrawToSeat` then `seat.fail`; log via a vow-watched vstorage node rather than `console`.

Things it does not do: multi-hop (PFM) transfers (`#10006`), and the `sharedLocalAccountP` / `nobleAccountP` `any`-typing is a known wart (`#9822`).

---

## Example contracts in `packages/orchestration/src/examples/`

**[updated]** Status per the examples README at `9712d748a` (USAGE.md's table is dated 2024-09-06 and lags):

| Contract | Status | Demonstrates |
|---|---|---|
| basic-flows | ready | account creation on local and remote chains; continuing offer with platform invitation makers |
| send-anywhere | ready | IBC transfer and CCTP via Noble |
| auto-stake-it | ready | `monitorTransfers` tap on a local account, auto-delegate on a remote chain |
| unbond | ready per README (USAGE.md says incomplete, `#9782`) | undelegate then transfer |
| staking-combinations | unit-tested only | combining actions in one offer; continuing offers |
| axelar-gmp | present, not in README | Axelar GMP to EVM; `axelar-gmp-account-kit.js` |
| swap-anything | present, not in README | swap on a remote chain via ChainHub |
| stake-bld, stake-ica, swap | work in progress | bindings need updating |

`shared.flows.js` holds `makeLocalAccount`, reused by several examples. `src/fixtures/query-flows.contract.js` is the ICQ test fixture.

For production-grade Orchestration code, `packages/portfolio-contract` (the ymax product) is the most current reference, though it is product code, not a teaching example.

---

## End-to-end testing

`multichain-testing/` runs against a Starship (Kubernetes) topology. Suites are selected by ava config: `ava.config.js` (default), `ava.fusdc.config.js`, `ava.queries.config.js`, `ava.rest.config.js`, `ava.staking.config.js`, `ava.xcs.config.js`, `ava.ymd.config.js`, with matching `config.*.yaml` chain topologies. The `Makefile` handles `make start`, `make port-forward`, `make teardown`. This is the harness the Stage 0 plan wraps rather than replaces.

Unit tests for flows should use the orchestration test utilities under `packages/orchestration/tools/` and `test/` rather than hand-mocked `zcf` and orchestrator objects; the latter pass under conditions the chain does not provide (sharp edges, testing note).

---

## dapp-orchestration-basics

Repo: `github.com/Agoric/dapp-orchestration-basics`. Layout: `contract/` (source, Makefile, package.json), `ui/`, `api/`, `e2e-testing/`, workspace root. Commands: `make fund`, `make e2e`, `yarn dev` in `ui/`. Multichain environment per `agoric-sdk/multichain-testing/README.md`.

**[updated]** Last commit March 2025; pins upgrade-17-era packages and a patched dev build of `@agoric/orchestration`. Use for repository layout only; its `orca.contract.js` predates the `chainHub`-in-flows and CAIP-2 changes above.
