# Agoric Chain Context Reference

Source: docs.agoric.com, agoric-sdk at `9712d748a` (2026-09-17), agoric-sdk releases, Agoric community forum
Retrieved: March 2026. Refreshed: 17 September 2026 (PactPay framing removed; facts re-verified against the SDK clone at `~/AAT/upstream/agoric-sdk` and the release notes)

Changes since the March 2026 version are marked **[updated]**.

---

## Chain overview

Agoric is a proof-of-stake chain in the Cosmos IBC ecosystem.

- **Consensus / framework**: CometBFT on Cosmos SDK. **[updated]** Mainnet is on `agoric-upgrade-23a` (released 27 July 2026, the recommended mainnet release), built on cosmos-sdk v0.53.6-alpha.agoric.1, cometbft v0.38.21-alpha.agoric.1, ibc-go v10.5.0. The SDK `master` branch pins cosmos-sdk v0.53.4 / cometbft v0.38.17 in `golang/cosmos/go.mod`. The March 2026 note of "Cosmos SDK v0.47.17 as of upgrade-21" is two upgrades stale.
- **Smart contracts**: Hardened JavaScript (SES) via the Endo platform, executing in SwingSet vats.
- **Security model**: object-capability (ocap).
- **Smart contract framework**: Zoe (offer safety enforced by the framework, not by contract code).
- **Cross-chain**: native IBC; Orchestration API for programmatic control of remote accounts; CCTP via Noble for USDC to and from EVM chains.
- **Staking and governance token**: BLD.
- **Fee token**: **[updated]** BLD. IST is no longer the fee token. The Inter Protocol sunset signaling proposal (April 2025) replaced IST with BLD in protocol-level roles (gas fees, SwingSet execution, wallet provisioning) and wound down vaults and minting over roughly 60 days to a 30 June 2025 shutdown. Some public pages on docs.agoric.com still describe IST as the fee token; treat the SDK and governance record as authoritative.
- **Stable asset for applications**: USDC via Noble over IBC.

### Current release line

**[updated]** Two release families now ship from agoric-sdk:

- `agoric-upgrade-NN` — chain-halting mainnet upgrades. Latest: `agoric-upgrade-23` (16 July 2026, the cosmos-sdk v0.53 migration) and `agoric-upgrade-23a` (27 July 2026, fixes invalid-JSON upgrade-info handling; recommended). Docker image `ghcr.io/agoric/agoric-sdk:76`. `@agoric/cosmos` package version `v0.36.0-u23.1`.
- `ymax-v0.3.YYMM-betaN` — frequent releases of the portfolio ("ymax") product built on Orchestration (`packages/portfolio-contract`, `portfolio-api`, `portfolio-deploy`). These are the most actively developed Orchestration contracts in the tree and are the best current reference for production Orchestration patterns, though they are product code rather than teaching examples.

Consequences for contract developers:

- **Node**: **[updated]** SDK `master` requires `node ^22.11 || ^24.14` (root `package.json` `engines`). Node 18 and 20 are no longer supported. The August 2026 ymax release notes moved the default to Node 24.
- **Yarn**: Yarn 4 through corepack (`corepack enable && yarn install`). Order `corepack enable` before `setup-node` in CI.
- **Type checking**: the SDK now uses `tsgo` (TypeScript 7 native preview) for `yarn lint:types` and `yarn typecheck-all`.
- **Formatting**: dprint, Prettier-compatible options (single quotes, trailing commas), enforced by a pre-commit hook.
- **Version pinning**: published packages carry `-uNN` suffixes matching the chain upgrade (for example `@agoric/cosmos v0.36.0-u23.1`). In-tree workspace versions (zoe 0.26.2, orchestration 0.1.0, ertp 0.16.2, vow 0.1.0, async-flow 0.1.0, zone 0.2.2, vat-data 0.5.2) are not the published tags. Pin dapps to the `-uNN` release matching the target network; bundling fails when versions drift from the chain's upgrade.

---

## Fast USDC

Fast USDC moves USDC from EVM chains to Cosmos chains in well under the 20-plus minutes CCTP alone takes, by having liquidity providers on Agoric advance funds while CCTP settlement completes.

### How it works

- Circle's CCTP burns USDC on the source EVM chain and mints on Noble.
- An Agoric Orchestration contract watches for the transfer, and LPs on Agoric advance the funds to the destination immediately.
- Settlement arrives in native USDC via Noble and repays the LP pool.

### Where the code is

**[updated]** Fast USDC now lives in three packages inside agoric-sdk: `packages/fast-usdc` (shared types and client), `packages/fast-usdc-contract` (the Orchestration contract), `packages/fast-usdc-deploy` (CoreEval proposals). `multichain-testing` has a dedicated `ava.fusdc.config.js` and `config.fusdc.yaml` for its end-to-end suite. The LP web UI is `github.com/Agoric/fast-usdc-lp-ui`.

### Third-party integration

Third-party contracts do not call Fast USDC directly. The pattern in the SDK's own `send-anywhere` example is the reference for CCTP from a contract: transfer to a Noble ICA held by the contract, then `nobleAccount.depositForBurn(destAccountId, denomAmt)` where `destAccountId` is a CAIP-style `${namespace}:${reference}:${address}` string, and the destination chain info carries `cctpDestinationDomain`. See `agoric-ref-orchestration.md`. Developer-facing documentation for third-party Fast USDC integration remains thin; the contract source is the documentation.

---

## USDC on Agoric

- USDC reaches Agoric via Noble over IBC.
- Denom on Agoric is an IBC denom hash (`ibc/...`) that differs per network. Devnet uses `ibc/toyusdc` (issuer `USDC_axl`); mainnet uses the Noble USDC denom. Keep it a contract term, never a constant.
- The vbank registry maps denoms to ERTP brands. From a flow: `const agoric = await orch.getChain('agoric'); const assets = await agoric.getVBankAssetInfo();` then find the entry whose `brand` matches.
- `agd query vstorage data published.agoricNames.vbankAsset` lists what the chain knows.

---

## Dapp structure

Standard layout (dapp-offer-up, dapp-orchestration-basics):

```
project-root/
  contract/
    src/
      contract.js          # start function (or `contract` wrapped by withOrchestration)
      contract.flows.js    # orchestration flows, if any
      proposal.js          # CoreEval proposal: starts the instance, registers names
    test/
      contract.test.js     # ava, under @endo/init
    Makefile               # build, deploy, fund
    package.json
  ui/                      # React, Keplr via @agoric/react-components
  package.json             # yarn workspaces root
  yarn.lock
```

**[updated]** Both dapp templates are stale relative to the SDK: dapp-offer-up pins `@agoric/zoe ^0.26.3-u16.1` (last commit April 2025) and dapp-orchestration-basics pins upgrade-17-era packages plus a patched dev build of `@agoric/orchestration` (last commit March 2025). Use them for repository layout and tooling, not as API references. For contract patterns, prefer the in-tree examples under `packages/orchestration/src/examples/` and the walk-through contracts on docs.agoric.com. The dapp-offer-up contract itself still works against current Zoe but uses the older `Far()` public facet rather than `zone.exo`, and imports `atomicRearrange` from `@agoric/zoe/src/contractSupport/atomicTransfer.js` rather than calling `zcf.atomicRearrange`.

### Contract deployment

Deployment is permissioned via CoreEval governance proposals on every network, including testnets. The full sequence with gas and verification rules is in `agoric-deploy-sequence.md`. In outline:

1. Bundle: `agoric run src/start-<contract>.js` (or `@endo/bundle-source` directly).
2. Install: `agd tx swingset install-bundle` with explicit `--gas 100000000`; verify the bundle id is on chain.
3. Propose: `agd tx gov submit-proposal swingset-core-eval <permit>.json <eval>.js`.
4. Vote and pass (immediate on a local chain; needs validator votes on devnet/emerynet).
5. Verify the instance in `published.agoricNames.instance` and the contract's vstorage root.

### Wallet and client

Clients interact through the Smart Wallet: format an offer as an `InvitationSpec` plus proposal, sign with Keplr, broadcast as `MsgWalletSpendAction` (fund-moving actions need `--allow-spend` from the CLI, or the equivalent in the UI kit), and the wallet factory routes to the user's smart wallet, which calls `E(zoe).offer()`. The UI kit is `github.com/Agoric/ui-kit` (`@agoric/react-components`, `@agoric/rpc`).

---

## Key repos

| Repo | Purpose | Notes (September 2026) |
|------|---------|------------------------|
| agoric-sdk | Core monorepo: SwingSet, Zoe, ERTP, Orchestration, Fast USDC, portfolio | Pin: `9712d748a` (`~/AAT/upstream/agoric-sdk`), `a2a3de9` (2026-09-11, Mac Studio clones). Has `AGENTS.md`, `.github/copilot-instructions.md`, and `.agents/skills/` (six Codex skills, all infrastructure). |
| dapp-orchestration-basics | Orchestration sample dapp | Stale (March 2025). Layout reference only. |
| dapp-offer-up | Minimal Zoe dapp | Stale (April 2025). Contract still valid for Zoe basics. |
| dapp-agoric-basics | Three example contracts (sell, swap, postal service) | Tutorial at docs.agoric.com/guides/getting-started/tutorial-dapp-agoric-basics. |
| ui-kit | React components, RPC helpers | Wallet connection, offer submission, vstorage reads. |
| fast-usdc-lp-ui | LP interface for Fast USDC | Production Orchestration front end. |
| agoric-dev-mcp | MCP server for Agoric development | Exists (listed on MCP directories). Not yet evaluated; relevant to Release 1. |
| documentation | Source of docs.agoric.com | Pin `d89bd22` (2026-04-28). No `llms.txt`. |

---

## Hardened JavaScript notes

Contracts run under SES:

- `harden()` everything that crosses a boundary: objects, arrays, records, return values.
- No ambient authority: no `fetch`, `fs`, `Math.random`, `Date.now`, `setTimeout`. Time comes from the chain timer service; randomness does not exist.
- `E()` for eventual sends to remote objects (across vats). Inside orchestration flows, do **not** wrap `OrchestrationAccount` methods in `E()`; call them directly and let the flow runner resolve vows (see `agoric-devnet-sharp-edges.md` item 1).
- **[updated]** Errors: import `Fail`, `q`, `makeError` from `@endo/errors`. The older `const { Fail, quote: q } = assert;` global-destructuring idiom still appears in dapp-offer-up but the SDK's own code has moved to the explicit import.
- **[updated]** Durable objects: `zone.exo`, `zone.exoClass`, `zone.exoClassKit` with `M.interface` guards; `zone.makeOnce` for one-time initialisation that survives upgrade. `Far()` remains valid for ephemeral objects but the public facet of an upgradable contract should be a zone exo.
- In orchestration code, return vows rather than promises across vat boundaries (upstream copilot rule).

```javascript
import { E } from '@endo/far';
import { M } from '@endo/patterns';
import { Fail, q } from '@endo/errors';

const publicFacet = zone.exo(
  'My PF',
  M.interface('My PF', { makeInvitation: M.callWhen().returns(InvitationShape) }),
  { makeInvitation() { return zcf.makeInvitation(handler, 'do thing'); } },
);

amount > 0n || Fail`amount must be positive: ${q(amount)}`;
```

---

## Object-capability security

Authority is a reference, not an ACL check. If code holds a reference it can call the object; if not, it cannot. Contracts receive the capabilities they need via `privateArgs`; the `permit` in a CoreEval declares which chain powers the proposal may request.

**[updated]** Upstream `AGENTS.md` (2026-09-11) states the facet-placement rule that the Release 1 idioms guide should lift verbatim: per-principal operations belong on that principal's facet, never on the public facet, because `E(zoe).getPublicFacet(instance)` is reachable by anyone holding the instance. A method on the public facet is acceptable only when it creates new state owned by a verifiable principal, returns pure information, or carries its own proof of authority. `packages/portfolio-contract/src/portfolio.exo.ts` is the textbook facet split (`reader`, `reporter`, `manager`, `planner`, `evmHandler`).

---

## Timer service

Contracts use the chain timer for deadline-based exits, scheduled wake-ups and expiry.

```javascript
// client-side proposal exit rule
exit: {
  afterDeadline: {
    deadline: TimeMath.addAbsRel(currentTime, RelativeTime(7n * 24n * 60n * 60n)),
    timer: chainTimerService,
  },
}
```

Two cautions from devnet experience (`agoric-devnet-sharp-edges.md` items 11 and 22): wake handlers written as `async wake()` with cross-vat `E()` calls are not upgrade-safe, and timer wake-ups may not fire on the shared devnet, so test timer logic on a local chain first.

---

## Inputs the upstream clone carries

Already present in `~/AAT/upstream/agoric-sdk` at `9712d748a`:

1. `packages/orchestration/src/examples/send-anywhere.contract.js` and `.flows.js` — the canonical Orchestration + CCTP example.
2. `packages/orchestration/USAGE.md` — example and e2e test matrix (its "last verified" date is 2024-09-06; the examples README is more current on which contracts are WIP).
3. `packages/orchestration/src/examples/README.md`.
4. `packages/async-flow/docs/async-flow-states.md` — activation lifecycle.
5. `AGENTS.md`, `.github/copilot-instructions.md`, `.agents/skills/` — upstream agent guidance.
6. `packages/portfolio-contract/src/portfolio.exo.ts` — POLA facet reference.

Still to evaluate: `agoric-dev-mcp` (whether it overlaps with or feeds Release 1), and `dapp-agoric-basics` against current Zoe.

Note: `~/AAT/upstream/agoric-sdk/node_modules` is from the January 2024 checkout and has not been reinstalled. Run `corepack enable && yarn install` in that directory (Node 22 or 24) before running any SDK tests locally.
