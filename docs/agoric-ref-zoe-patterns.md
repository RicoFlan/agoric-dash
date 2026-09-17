# Zoe Contract Patterns Reference

Source: docs.agoric.com, dapp-offer-up (`main`, last commit April 2025), agoric-sdk `packages/zoe` at `9712d748a` (2026-09-17)
Retrieved: March 2026. Refreshed: 17 September 2026 (PactPay framing removed; offer-up source corrected to match upstream; durable-contract section rewritten)

Changes since the March 2026 version are marked **[updated]**.

---

## Zoe fundamentals

Zoe is Agoric's smart contract framework. Its core guarantee is offer safety: every offer either gets what it asked for (`want`) or a full refund of what it put in (`give`), regardless of what the contract does. Contracts never hold assets; Zoe escrows them and the contract only reallocates.

- **Installation**: contract code, identified by a bundle id.
- **Instance**: a running contract created from an installation with specific terms, issuers and private args.
- **Invitation**: a capability (an ERTP payment of the invitation brand) to make an offer to a specific instance.
- **Seat**: a party's position in a contract; holds its escrowed allocation. `ZCFSeat` inside the contract, `UserSeat` outside.
- **Proposal**: `{ give, want, exit }`. Keywords in `give` and `want` are chosen by the contract.
- **Proposal shape**: a pattern the contract attaches to an invitation; Zoe rejects offers that do not match before the handler runs.

**[updated]** Shapes for these are exported from `@agoric/zoe/src/typeGuards.js`: `InvitationShape`, `ProposalShape`, `FullProposalShape`, `AmountKeywordRecordShape`, `OfferHandlerI`. Use them in `M.interface` guards rather than redefining.

---

## Contract lifecycle

```
1. Bundle contract source        -> bundleSource() / agoric run
2. Install on chain              -> E(zoe).install(bundle)          (agd tx swingset install-bundle)
3. Start instance with terms     -> E(zoe).startInstance(installation, issuers, terms, privateArgs)
4. Get publicFacet               -> E(zoe).getPublicFacet(instance)
5. Get invitation                -> E(publicFacet).makeXInvitation()
6. Make offer                    -> E(zoe).offer(invitation, proposal, payments, offerArgs)
7. Get result / payout           -> E(userSeat).getOfferResult() / E(userSeat).getPayout(keyword)
```

On chain, steps 2 and 3 happen inside a CoreEval proposal and step 6 goes through the Smart Wallet.

---

## `offer-up.contract.js` (upstream source, abridged)

**[updated]** The March 2026 copy of this contract differed from upstream in two ways: it called `zcf.atomicRearrange(...)` where upstream imports `atomicRearrange` from `@agoric/zoe/src/contractSupport/atomicTransfer.js` and calls `atomicRearrange(zcf, ...)`, and it omitted the `meta.customTermsShape` export. Both forms of rearrange work (`zcf.atomicRearrange` exists on the ZCF object), but the snippet corpus should match upstream exactly.

```javascript
// @ts-check
// @jessie-check
import { Far } from '@endo/far';
import { M, getCopyBagEntries } from '@endo/patterns';
import { AssetKind } from '@agoric/ertp/src/amountMath.js';
import { AmountShape } from '@agoric/ertp/src/typeGuards.js';
import { atomicRearrange } from '@agoric/zoe/src/contractSupport/atomicTransfer.js';
import '@agoric/zoe/exported.js';

const { Fail, quote: q } = assert;   // older idiom; SDK code now imports from '@endo/errors'

const sum = xs => xs.reduce((acc, x) => acc + x, 0n);
const bagCounts = bag => getCopyBagEntries(bag).map(([_k, ct]) => ct);

/** @typedef {{ tradePrice: Amount; maxItems?: bigint }} OfferUpTerms */

export const meta = {
  customTermsShape: M.splitRecord({ tradePrice: AmountShape }, { maxItems: M.bigint() }),
};
harden(meta);
export const customTermsShape = meta.customTermsShape;   // older metadata API
harden(customTermsShape);

/** @param {ZCF<OfferUpTerms>} zcf */
export const start = async zcf => {
  const { tradePrice, maxItems = 3n } = zcf.getTerms();

  const itemMint = await zcf.makeZCFMint('Item', AssetKind.COPY_BAG);
  const { brand: itemBrand } = itemMint.getIssuerRecord();

  const proposalShape = harden({
    give: { Price: M.gte(tradePrice) },
    want: { Items: { brand: itemBrand, value: M.bag() } },
    exit: M.any(),
  });

  const proceeds = zcf.makeEmptySeatKit().zcfSeat;

  /** @type {OfferHandler} */
  const tradeHandler = buyerSeat => {
    const { want } = buyerSeat.getProposal();   // guaranteed to match proposalShape
    sum(bagCounts(want.Items.value)) <= maxItems ||
      Fail`max ${q(maxItems)} items allowed: ${q(want.Items)}`;

    const newItems = itemMint.mintGains(want);
    atomicRearrange(zcf, harden([
      [buyerSeat, proceeds, { Price: tradePrice }],
      [newItems, buyerSeat, want],
    ]));
    buyerSeat.exit(true);
    newItems.exit();
    return 'trade complete';
  };

  const makeTradeInvitation = () =>
    zcf.makeInvitation(tradeHandler, 'buy items', undefined, proposalShape);

  const publicFacet = Far('Items Public Facet', { makeTradeInvitation });
  return harden({ publicFacet });
};
harden(start);
```

What it teaches: `makeZCFMint` for a contract-owned asset type; a proposal shape doing validation before the handler; an internal seat for proceeds; atomic rearrangement; exiting seats so payouts happen.

What it does not teach: durability. `Far()` public facets and closure state do not survive contract upgrade. See the durable pattern below.

---

## Key Zoe APIs

### ZCF (Zoe Contract Facet)

```javascript
const { myTerm, issuers, brands } = zcf.getTerms();
const mint = await zcf.makeZCFMint('TokenName', AssetKind.NAT);
const { zcfSeat, userSeat } = zcf.makeEmptySeatKit();
zcf.makeInvitation(offerHandler, description, customDetails, proposalShape);
zcf.atomicRearrange(harden([[fromSeat, toSeat, { Keyword: amount }]]));   // or atomicRearrange(zcf, ...)
await zcf.saveIssuer(issuer, 'Keyword');
zcf.shutdown('reason');
zcf.setTestJig?.(…)   // test-only hook
```

### Seats

```javascript
const { give, want, exit } = seat.getProposal();
seat.getCurrentAllocation();
seat.exit();                 // normal exit; payouts follow
seat.exit(completion);       // exit with a completion value
seat.fail(error);            // exit with failure; offer result rejects
seat.hasExited();
```

**[updated]** For rollback in orchestration flows the SDK examples use `seat.fail(msg)` then `throw makeError(msg)`, not `seat.exit(msg)`.

### Patterns (`@endo/patterns`)

```javascript
M.eq(value)  M.gte(amount)  M.any()  M.string()  M.bigint()  M.bag()  M.scalar()
M.splitRecord(required, optional, rest)
M.recordOf(keyShape, valueShape, { numPropertiesLimit })
M.and(...)  M.not(...)
M.interface('Name', { method: M.call(argShape).returns(resultShape),
                      asyncMethod: M.callWhen(M.await(argShape)).returns(resultShape) })
mustMatch(specimen, pattern)   // throws with a useful message
```

### atomicRearrange

Moves allocations between seats atomically; Zoe checks rights conservation and offer safety for every seat touched. Any violation throws and nothing moves.

```javascript
zcf.atomicRearrange(harden([
  [seatA, seatB, { Token: amount1 }],
  [seatB, seatC, { Token: amount2 }],
  [fromSeat, toSeat, fromAmounts, toAmounts],   // four-element form when keywords differ
]));
```

---

## Durable contract pattern

**[updated]** This section is rewritten. Contracts that must survive upgrade use the `zone` API (`@agoric/zone`) rather than `Far()` and closures, and the current start signature is `start(zcf, privateArgs, baggage)`; orchestration contracts get a `zone` directly from `withOrchestration`.

```javascript
import { M } from '@endo/patterns';
import { makeDurableZone } from '@agoric/zone/durable.js';
import { InvitationShape } from '@agoric/zoe/src/typeGuards.js';

export const start = async (zcf, privateArgs, baggage) => {
  const zone = makeDurableZone(baggage);

  // durable collections and one-time values
  const records = zone.mapStore('records');
  const config = zone.makeOnce('config', () => harden({ createdAt: 0n }));

  // durable singleton facet with an interface guard
  const publicFacet = zone.exo(
    'Escrow PF',
    M.interface('Escrow PF', {
      makeCreateInvitation: M.callWhen().returns(InvitationShape),
      getStatus: M.call(M.string()).returns(M.string()),
    }),
    {
      makeCreateInvitation() { return zcf.makeInvitation(createHandler, 'create'); },
      getStatus(id) { return records.get(id).status; },
    },
  );

  // durable class for per-record objects
  const makeRecord = zone.exoClass('Record', RecordI, id => ({ id, status: 'pending' }), {
    release() { this.state.status = 'released'; },
  });

  return harden({ publicFacet });
};
```

Rules that follow from how zones work:

- **Kinds must be redefined on every incarnation.** Every `zone.exo*` call with a given tag has to run again at start; SwingSet requires it.
- **The interface shape freezes under a tag.** Adding a method to a facet and redeploying under the same exo label does nothing; the zone keeps the original shape. Use a new label, or plan interface changes as explicit upgrades (sharp edges item 9). This is the single most confusing failure for someone new to the platform, and for coding agents.
- **State is `this.state`**, whose fields are the ones returned by the `init` function; assignments persist automatically.
- **`zone.makeOnce`** runs its initialiser once per instance lifetime and returns the stored value on later incarnations; it may return a promise or vow (used for shared orchestration accounts).
- **Re-read durable state before every `store.set()`** in async code; two flows can interleave between a read and a write (sharp edges item 5).
- **`prepareExoClass` / `prepareExoClassKit` from `@agoric/vat-data`** are the lower-level equivalents; new code should use `zone.exoClass` / `zone.exoClassKit`.

Facet placement (from upstream `AGENTS.md`): per-principal operations go on that principal's facet, reached through a lookup that throws on miss; the public facet only carries methods that create principal-owned state, return pure information, or carry their own proof of authority. Split read-only from admin facets before exposing write access.

---

## Testing

**[updated]** Unit tests use ava with `@endo/init` loaded first (`prepare-test-env-ava.js` from `@agoric/zoe/tools/`), and `setUpZoeForTest()` or `makeZoeKitForTest()` from `@agoric/zoe/tools/setup-zoe.js` to get a real Zoe with a fake vat admin. `@agoric/zoe/tools/manualTimer.js` drives timer-based logic deterministically. Tests that mock `zcf`, seats and the timer by hand pass under conditions the chain never provides and should be treated as a negative example (sharp edges, testing note).

```javascript
import { test } from '@agoric/zoe/tools/prepare-test-env-ava.js';
import { setUpZoeForTest } from '@agoric/zoe/tools/setup-zoe.js';
import { makeManualTimer } from '@agoric/zoe/tools/manualTimer.js';

test('buys items', async t => {
  const { zoe, bundleAndInstall } = await setUpZoeForTest();
  const installation = await bundleAndInstall(contractPath);
  const { publicFacet } = await E(zoe).startInstance(installation, { Price: issuer }, { tradePrice });
  …
});
```

---

## Reference contracts on docs.agoric.com

- **Atomic swap** — two-party exchange; the closest simple pattern to escrow. `docs.agoric.com/guides/zoe/contracts/atomic-swap`
- **Covered call** — party A deposits, party B may exercise before a timer deadline; funds return otherwise. Timer-based expiry. `docs.agoric.com/guides/zoe/contracts/covered-call`
- **Escrow to vote** — tokens locked and released on a governance outcome. `docs.agoric.com/guides/zoe/contracts/escrow-to-vote`
- **Vault, constant-product AMM, and others** — listed at `docs.agoric.com/guides/zoe/contracts/`.

The docs walk-throughs use `tut-01-hello`, `tut-02-state`, `tut-03-access` branches of dapp-offer-up for the hello-world, state and access-control contracts.

---

## Client-side offer pattern

```javascript
// lookups
const instance = await E(agoricNames).lookup('instance', 'MyContract');
const brand = await E(agoricNames).lookup('brand', 'USDC');

// proposal
const proposal = harden({
  give: { Price: { brand, value: 100_000_000n } },   // 100 USDC (6 decimals)
  want: {},
  exit: { afterDeadline: { deadline, timer } },
});

// Smart Wallet InvitationSpec: the wallet calls publicFacet[publicInvitationMaker](...invitationArgs)
const invitationSpec = {
  source: 'contract',
  instance,
  publicInvitationMaker: 'makeCreateInvitation',
  invitationArgs: [],
};
// then: wallet.executeOffer({ id, invitationSpec, proposal, offerArgs })
```

Other `InvitationSpec` sources: `'purse'` (an invitation already held), `'continuing'` (invitation makers returned by a previous offer, the pattern orchestration examples use for account control), `'agoricContract'` (path lookup through agoricNames). Board ids and instance handles change on every deploy; the client must look them up, never hardcode (sharp edges item 18).

---

## Pattern checklist for an escrow-style contract

| Pattern | Use |
|---|---|
| `zcf.makeInvitation` + proposal shape | one invitation maker per user action (create, confirm, release, dispute) |
| `zcf.makeEmptySeatKit` | contract-held escrow seat |
| `atomicRearrange` | move between the escrow seat and party seats; fee extraction in the same rearrangement |
| `seat.exit()` / `seat.fail()` | close out; fail on rollback |
| `zone.exo` / `zone.exoClass` | durable public facet and per-record objects |
| `zone.mapStore` | records by id, with an id-prefix term on redeploy (sharp edges item 10) |
| timer service | expiry and auto-refund; test on a local chain, not devnet |
| Orchestration (`localTransfer`, `transfer`) | cross-chain funding and payout, if needed |
