# P8 Tier 2 — investigation findings

Investigated 2026-09-17 against mainnet `agoric-3`, the production database (read-only) and this
codebase. Every claim below states how it was checked. These are findings, not changes: nothing here
has been implemented.

Three of these findings contradict the P8 brief. They are marked **⚠ contradicts the brief** and
stated plainly rather than worked around, per §8.

---

## 0. ⚠ The coverage floor — found while investigating 2.1, and larger than 2.1

**Message-derived series do not cover indexed history. They start 2026-05-30. The dashboard says
they start 2026-01-01.**

Per-series first indexed day, from `daily_metrics` (production, read-only):

| Group | First day | Series |
|---|---|---|
| Transaction / economic | **2026-01-01** | `tx_success`, `tx_failed`, `fee_paid`, `gas_used`, `bank_credits_volume`, `transfer_volume`, all `ibc_transfer_*` (non-orch) |
| End-block orchestration | **2026-05-19** | `ibc_transfer_*_orch` (the running backfill's start height) |
| **Message-decoded** | **2026-05-30** | `staking_delegations`, `staking_undelegations`, `staking_redelegations`, `wallet_actions`, `offer_category`, `offer_source`, `offer_maker`, `offer_outcome`, `invoke_target`, `block_gas_limit`, `gas_wanted` |
| Governance | first *occurrence* 2026-07-22 | `gov_proposals`, `gov_votes` |

`INDEXED_HISTORY_FROM_DAY` is a single constant, `"2026-01-01"` (`src/lib/semantics.ts:20`). The API
clamps `from` to it, the UI banner says “Indexed rollups and participation metrics start 2026-01-01
UTC”, and `q4_new_addresses` cites it in its definition. There is no per-series floor anywhere in the
read path.

**Proof that the gap is missing coverage, not missing activity:**

- `tx_search` on the archive for `/cosmos.staking.v1beta1.MsgDelegate` over heights
  23,900,000–23,950,000 (~3.5 days, ~February 2026) returns **total_count = 98**. Over that same
  period `staking_delegations` has **no rows at all**.
- Cosmos proposals **116** (2026-03-02), **117** (2026-03-05) and **118** (2026-03-30) were all
  submitted inside “indexed history” and all reached a terminal status — 116 and 118 PASSED, 117
  REJECTED — so each necessarily carried votes on-chain. `gov_proposals` counts **2**, and
  `gov_votes` has **zero** days before 2026-07-22.

**Why it matters.** Any range reaching before 2026-05-30 silently mixes “not indexed” with “zero”,
and puts those series next to transaction counts that genuinely do cover the period. A reader
selecting *Indexed history* today sees 2 governance proposals where the chain had 5, and reads a
staking and offer history that begins five months late. This is the failure mode the project exists
to avoid.

**Recommendation.** A per-series coverage floor in the read path, derived from the data rather than
declared: report each series' first indexed day alongside its values, and blank (not zero) any
requested day before it. That is a read-time change and does not need a reindex. Backfilling the
message-decoded series to 2026-01-01 is a separate, expensive decision.

---

## 2.1 Where does Agoric governance actually appear?

**It does not appear anywhere in the offer stream, and it is not mis-bucketed. The rules are correct
and inert.** The reportable problem is the coverage floor above, not the category rule.

Checked:

- **Every governance instance in the name map already matches an existing rule.**
  `src/config/agoricNames.json` holds 41 instances, 8 of them governance:
  `CrabbleCommittee`, `CrabbleGovernor`, `VaultFactoryGovernor`, `econCommitteeCharter`,
  `economicCommittee`, `kreadCommittee`, `kreadCommitteeCharter`, `reserveGovernor`. All 8 are
  caught by `categoryFromInstanceName`'s `/(Committee|Governor|Charter)$/` plus the
  `economicCommittee` special case (`src/lib/offerCategory.ts`). If a committee offer arrived it
  would be categorised `governance` today.
- **No governance traffic exists in any offer dimension.** Over all indexed history:
  - `offer_instance` has 6 dimensions, all resolving to `ymax0`, `ymax1` or a `psm-*` — no committee,
    charter or governor.
  - `offer_maker` has 10 dimensions: `SettleTransaction`, `SubmitEvidence`, `SimpleRebalance`,
    `makeGiveMintedInvitation`, `Withdraw`, `Deposit`, `makeWantMintedInvitation`,
    `makeWithdrawInvitation`, `makeOpenPortfolioInvitation`, `makeDepositInvitation` — no
    `VoteOnParamChange`, `VoteOnApiCall`, or charter-member maker.
  - `invoke_target` has 29 dimensions, all `planner`, `evmWalletHandler`, `ymaxControl` or
    per-portfolio delegates.
- **Agoric contract governance has been dormant since mid-2025, before indexed history begins.**
  `published.committees.Economic_Committee.latestQuestion` was last written at **block 20,349,129**;
  `latestOutcome` at **block 20,364,327**. Both are far below the indexer's start height
  (25,498,665). The question itself was a `param_change` on `LiquidationMargin` with a closing
  deadline of `+1751400076` — 2026-07-01 in Unix seconds, i.e. the last Inter Protocol parameter vote
  before the 30 June 2025 shutdown. `published.committees.kread-gov.latestQuestion` is empty.

**Deliverable: no category-rule change.** Changing the rules would be motion without effect. Two
honest options instead, in order of preference:

1. **Keep the category, label it dormant.** State that Agoric contract governance has had no
   recorded activity since block 20,349,129 (the last Economic Committee question), and that the
   committees that governed Inter Protocol parameters lost their subject when Inter was sunset. A
   zero that is explained is worth more than a zero that is hidden.
2. **Stop presenting Cosmos governance as covered.** Fix the coverage floor (finding 0) so “2
   proposals” reads as “2 since 2026-05-30” and not as “2 since 2026-01-01”. Without this the
   governance figure is simply wrong: the chain had 5 proposals in the stated window.

---

## 2.2 Is SwingSet compute observable?

**No. Not from `block_results`, and not from vstorage. Recommend dropping the idea — do not ship a
proxy.**

Checked on a block that contains a real SwingSet wallet action (height **27,385,904**, found via
`tx_search` for `/agoric.swingset.MsgWalletSpendAction`):

- `block_results` for that height has only `height`, `txs_results`, `finalize_block_events`,
  `validator_updates`, `consensus_param_updates`, `app_hash`. There are no `begin_block_events` or
  `end_block_events` at all.
- Case-insensitive search of the entire serialized `block_results` for `bean`, `computron`, `crank`,
  `vat`, `compute` and `runPolicy`: **all absent**. The only hit for `swingset` is the message
  `action` attribute `/agoric.swingset.MsgWalletSpendAction`.
- The sole compute-shaped numbers on the tx are Cosmos `gas_wanted` 400,000 and `gas_used` 135,888 —
  ante-handler and message-routing cost. They do not move with SwingSet execution.
- `finalize_block_events` contains `state_change` events for vstorage paths only
  (`published.wallet.…`, `published.ymax0.…`).

Also checked, and also negative:

- `published` has 15 children — `agoricNames, auction, boardAux, committees, crabble, fastUsdc,
  kread, priceFeed, provisionPool, psm, reserve, vaultFactory, wallet, ymax0, ymax1`. No compute or
  telemetry path.
- The vstorage root has `activityhash, beansOwing, bundles, egress, highPriorityQueue,
  highPrioritySenders, published`. `beansOwing` is a per-address **fee debt** ledger, not consumption
  per block; `swingStore` reads back empty (`{"value":""}`).
- `/agoric/swingset/params` exposes the limits (`blockComputeLimit` 6,500,000,000 beans,
  `xsnapComputron` 100, `feeUnit` 150,000,000,000 — all as the brief states) but no consumption
  counter. There is no `/agoric/swingset/` query route returning per-block beans.

**Conclusion.** Beans and computrons consumed per block exist only in the validator's slog, which is
off-chain, per-node, and not something this indexer can read. **Drop it.** Q1's gas-utilization chart
answers a Cosmos question and should say so rather than be replaced by a SwingSet-shaped number
derived from Cosmos gas — that would be exactly the proxy the brief forbids.

---

## 2.3 YMax ingestion completeness and contract identity

### a. ⚠ The reference schema does not exist — `Agoric/ymax-subql` is not a YMax schema

The brief asks to diff `Agoric/ymax-subql`'s schema against our ingestion. That repo's
`schema.graphql` has **no portfolio, position or flow entity at all**. Its README titles it
“Agoric indexer”, it is the SubQuery indexer behind the Inter dashboard (info.inter.trade), and its
entities are `Vault`, `VaultLiquidation`, `VaultManagerMetrics(+Daily)`, `VaultManagerGovernance`,
`PsmMetrics(+Daily)`, `PsmGovernance`, `ReserveMetrics`, `OraclePrice(+Daily)`, `BoardAux`,
`Wallet`, `IBCTransfer`, `TransferEvent`, `Message`, `StateChangeEvent`, `BundleInstall`. Last push
**2025-05-27**, single branch `main` — stale by ~16 months and predating the Inter sunset. The name
is misleading.

So the diff was done against the authoritative source instead: what `published.ymax0|ymax1.*`
actually publishes on-chain today.

*(One incidental payoff: that schema's `BundleInstall` entity — `uncompressedSize`, `bundle`,
`submitter` — is a worked precedent for Tier 5.1/5.2, contract-landing activity and bundle-install
storage fees.)*

### b. Fields published on-chain that we do not capture

**Portfolio status** (`published.ymaxN.portfolios.<p>`), sampled live from `ymax1.portfolio255`:

| Field | Captured? | Why it matters |
|---|---|---|
| `targetAllocation` e.g. `{"Aave_Base":"+100","Compound_Base":"+0"}` | **no** | Target versus actual `netTransfers` is *allocation drift* — a genuine intelligence signal, not another counter |
| `sourceAccountId` e.g. `eip155:8453:0xa301…` | **no** | The EVM wallet that funded the portfolio. A participant identity that one Agoric address cannot inflate — directly useful to Q4 |
| `nobleForwardingAddress` | **no** | The CCTP forwarding leg; the missing middle of Q3's orchestration story |
| `accountStateByChain[c].state` (`active`, …) | partially — address and chainId only | An account stuck non-active is an operational signal we discard |
| `accountStateByChain[c].routerFactory` | **no** | EVM router contract per chain |
| `accountsPending` | **no** | Portfolios mid-onboarding |
| `rebalanceCount` | **summarized, then dropped** | `summarizePortfolio` computes it (`ymaxVstorage.ts:161`) but `ymax_portfolio` has no column for it and `ymaxRollup.ts` never writes it. Cheapest fix on this list |

**`published.ymaxN.pendingTxs.<txN>` — ignored entirely.** `classifyYmaxPath` returns
`kind: "other"` and the rollup drops it. There are **4,063** entries under `ymax0` alone. Each one
carries, verified by sampling `ymax1` tx1/tx50/tx200/tx900/tx1500/tx2000:

- `type` — observed `CCTP_TO_EVM`, `GMP`, `ROUTED_GMP`, `IBC_FROM_AGORIC`, `MAKE_ACCOUNT`
- `status` — observed `success`, `pending`, and **`failed`**
- `destinationAddress` as a CAIP id, so the **final destination chain** is published:
  `eip155:43114` (Avalanche), `eip155:10` (Optimism), `eip155:8453` (Base)
- `sourceAddress`, `payloadHash`, `details.instructionType`

This is the largest gap, and it bears directly on the brief's §4 note that “orchestrated outflow is
dimensioned by denom, not destination, so the dashboard does not falsely claim Noble is a final
destination.” That is true and honest — but the chain **does** publish the real destination, and it
also publishes which legs **failed**. Today's outflow figure is counted at initiation, so failed
legs are inside it with no way to see them.

**`published.ymaxN.evmWallets.<0x…>` — ignored entirely.** 162 entries under `ymax1`. Distinct EVM
wallets are a Q4 base-broadening measure of the kind the brief wants for provisioning: hard for a
single actor to inflate.

**Flow amounts are sampled, not complete.** Amounts come from the portfolio status's `flowsRunning`
map, not from the flow node, so a flow that starts and completes between two observed portfolio
updates is recorded without its amount. A known limitation, worth a disclosure.

### c. ⚠ `ymax0` and `ymax1` are two concurrent deployments, not a redeploy boundary

The brief asks whether they are two products or one across a redeploy boundary. Neither: they are
both live **right now**, side by side.

| | `ymax0` | `ymax1` |
|---|---|---|
| vstorage children | `evmWallets, pendingTxs, portfolios` | identical |
| portfolios published | 111 | 266 |
| portfolios in our DB | 111 | 266 |
| positions | 278 | 661 |
| net principal (`Σ totalIn − totalOut`) | **308,689,429** (~$309) | **15,853,230,013,474** (~$15.85M) |
| gross in / out | 1,907,976,143 / 1,599,286,714 | 27,205,990,201,853 / 11,352,760,188,379 |
| denom | `ibc/FE98…76A9` (USDC) | same |
| newest `updated_height` | 27,385,904 (head) | 27,378,356 |
| oldest `updated_height` | 22,062,329 | 21,946,152 |
| flows by month | May 19, Jun 28, Sep 75 | May 83, Jun 57, Sep 64 |

Both were updated within hours of each other at chain head, both have flows in every month we have
coverage for, and `ymax1`'s oldest update *precedes* `ymax0`'s — so `ymax0` is not “the one after”.
Both portfolio id namespaces start at `portfolio0`, so `portfolio101` exists in both and means two
different things.

Same denom and decimals for both, so the 50,000× principal gap is real and not a units artifact.
`ymax0` carries roughly **$309** of net principal against `ymax1`'s **$15.85M**, on a comparable
number of portfolios — the profile of a canary or staging deployment kept alive on mainnet, not of a
product.

**Good news on data integrity:** `ymax_portfolio`, `ymax_position` and `ymax_flow` are all keyed by
`(contract, portfolio, …)`, so the two never collide in storage. The one place the contract is lost
is the `invoke_target` series, whose dimensions are bare (`delegate-portfolio101`,
`portfolioMandate-portfolio102`), so ymax0 and ymax1 portfolios with the same number merge there.

**Recommendation.** Not an annotation about continuity — there is no boundary to annotate. Q3 should
either **split the two contracts** or say which one it is reporting. Summing them is numerically
harmless (ymax0 is 0.002% of principal) but presents a dust deployment and a $15.9M product as one
number, and would mislead badly the moment ymax0's balance moves.

---

## Incidental: a 16-action inconsistency in the offer rollups

`offer_category` sums to **4,433** over all history while `wallet_actions` sums to **4,417**. The
entire 16-action difference is on **2026-05-30**, in hours 00, 01, 04 and 05. Those hours have
`offer_category` and `offer_outcome_category` rows but **no** `wallet_actions` rows, while
`tx_success` is present — so the blocks were indexed. `offer_outcome_category` (2,667) likewise runs
10 ahead of `offer_outcome` (2,657).

The signature is a category rebuild that wrote categories for actions the base indexer never recorded
as wallet actions — plausibly a test run on the day `agoricNames.json` was generated
(`generatedAt: 2026-05-30T05:39:54Z`, inside the affected hours).

It changes nothing on the dashboard today — the Q2 denominator is `offer_category`'s own total, so it
is internally consistent — but **Tier 3.4's acceptance test is “no other series moved”**, and that
comparison needs this 16-action offset recorded as the baseline or it will read as fresh drift.

---

## What this means for Tier 3

- **3.1 (refresh the name map) still stands** and is still the main lever on the unclassified share.
- **3.2 has no Tier 2 rule changes to apply.** Governance needs no rule change (2.1); compute needs
  no rule at all (2.2); YMax identity is a presentation decision, not an index-time one (2.3c).
- **A rule change Tier 2 surfaced on its own is worth more than any of them.** `offer_maker` shows
  `SubmitEvidence` at **444** actions and `SimpleRebalance` at **63**, both currently falling to
  `other` — together **507 of the 570 unclassified actions, 89% of the unclassified share**. Both are
  continuing offers carrying no instance, which is exactly why the maker fallback misses them. Both
  identified against Agoric's own source:

  | Maker | Defined in `Agoric/agoric-sdk` | Belongs in |
  |---|---|---|
  | `SubmitEvidence` | `packages/fast-usdc-contract/src/exos/operator-kit.ts` — the FastUSDC **operator kit**, an oracle operator submitting CCTP evidence | `fast_usdc` (automated) |
  | `SimpleRebalance` | `packages/portfolio-contract/src/portfolio.exo.ts` — the portfolio contract, of which `ymax0`/`ymax1` are the instances | `ymax` (user-initiated) |

  Projected effect on Q2, holding today's counts (4,433 categorized actions, 573 user-initiated,
  570 unclassified):

  | | today | after these two rules |
  |---|---|---|
  | unclassified share | 12.9% | **~1.4%** (63 actions) |
  | user-initiated share | 13.0% | **~14.4%** (+63 to `ymax`) |
  | stated bound on the true share | 13.0%–26.0% | **14.4%–15.8%** |

  That is the single largest available improvement to the figure Tier 3.4 is measured on, and it
  costs nothing extra because it rides the same rebuild. It should be settled and included **before**
  the rebuild runs, per §5. It is also a *reclassification*, so it belongs in the “what changed this
  period” counting-rule log alongside the 2026-09-03 YMax entry.
- **Nothing can start until the end-block backfill finishes.** It is at height 26,041,664 of
  25,498,665–27,169,144 — about 32% through, checkpointed in `backfill_checkpoint` as
  `endblock_ibc_orch`.
