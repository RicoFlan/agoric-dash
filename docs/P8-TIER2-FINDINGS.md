# P8 Tier 2 — investigation findings

Investigated 2026-09-17 against mainnet `agoric-3`, the production database (read-only) and this
codebase. Every claim below states how it was checked. These are findings, not changes: nothing here
has been implemented.

Two of these findings contradict the P8 brief as it now stands on `main`. They are marked
**⚠ contradicts the brief** and stated plainly rather than worked around, per §8. A third — the
coverage floor — was written against the earlier brief and has since been **confirmed and adopted
into it** (PR #13, §3 “Three different history boundaries”); it is kept below because the *dashboard*
still presents those boundaries as one.

One item in this document was **corrected after review**: the 16-action offset on the floor day. See
that section for the corrected diagnosis and what Tier 3.4 must baseline.

---

## 0. The coverage floor — found while investigating 2.1, and larger than 2.1

**Message-derived series do not cover indexed history. They start 2026-05-30. The dashboard says
they start 2026-01-01.**

> **Status.** Found here independently; the brief on `main` now records the same three boundaries
> (§3, from PR #13) including the offer-series floor at 2026-05-30 / height 25669513, and reaches the
> same 106-of-260-days figure. So this is no longer a disagreement with the brief — but it remains an
> open defect in the **product**: `INDEXED_HISTORY_FROM_DAY` is still a single constant, the banner
> still says 2026-01-01, and nothing in the read path distinguishes “not indexed” from “zero”.

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

**Recommendation.** A per-series coverage floor in the read path: report each series' floor alongside
its values, and blank (not zero) any requested day before it. Read-time; no reindex.

**The floors must be DECLARED, not derived.** An earlier draft of this document recommended deriving
each floor from the series' first row. That is wrong, and wrong in the same direction as the bug it
was meant to fix — just pointed the other way. `daily_metrics` holds only day, series, dimension and
value, so a first-row rule cannot tell *no activity* from *no coverage*, and it would blank days we
genuinely know to be zero.

`gov_proposals` is the proof, and it is the very series this finding is about. Its first row is
2026-07-22, but the series has been indexed since 2026-05-30 07:00. The chain's proposals are 118 on
2026-03-30 and then 119 on 2026-07-22 — confirmed live against
`/cosmos/gov/v1/proposals` — so **2026-05-30 to 2026-07-21 is 53 days of real, observed zero**. A
derived floor would blank all 53 as unknown, discarding something we actually know. For this project,
understating what we know is as much a defect as overstating it.

Declare them in a small map in `semantics.ts`, each entry carrying how it was established:

| Series | Floor | How established |
|---|---|---|
| `tx_success`, `tx_failed`, `fee_paid`, `gas_used`, `bank_credits_volume`, `transfer_volume`, `ibc_transfer_*` | 2026-01-01 | Cosmos-level backfill, below the indexer start |
| `ibc_transfer_amount_out_orch`, `ibc_transfer_out_count_orch` | 2026-05-19 | Indexer start, height 25498665 |
| `offer_category`, `offer_outcome_category` | 2026-05-30 **00:00** | Category backfill start, height 25669513 |
| `wallet_actions`, `offer_source`, `offer_outcome`, `invoke_target`, `staking_*`, `block_gas_limit`, `gas_wanted` | 2026-05-30 **07:00** | Base indexer's first write |

Declared beats derived on three counts: it is honest about provenance, it needs no schema change and
is reviewable in a diff, and — the one a derived floor cannot do at all — it can express the
**intra-day** boundary. `wallet_actions` begins seven hours into its first day. A day-granular
derived floor would get that series wrong on precisely the day this document is about.

Guard the drift that declaring invites with a test: derive candidate floors from the data and assert
each declared floor is no later than the first observed row for that series. That catches a floor
that has moved without ever letting inference decide the answer.

*(Raised by CodeRabbit and the reviewer on #15; the `gov_proposals` illustration and the 53-day
window are verified here.)*

Backfilling the message-decoded series below 2026-05-30 is a separate, expensive decision — and note
the brief's own warning that scoping such a backfill from 2026-01-01 would replay four and a half
months that can never yield rows. The base indexer's own floor is 2026-05-19 (height 25498665);
2026-01-01 is a *reporting* floor reached by a Cosmos-level backfill only.

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
  deadline of `+1751400076` — **2025-07-01T20:01:16Z**. That is the day *after* the 30 June 2025
  shutdown, so this was the final Inter Protocol parameter vote, closing as the protocol wound down.
  `published.committees.kread-gov.latestQuestion` is empty.

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
| positions, all | 278 | 661 |
| positions counted by Q3 (`total_in >= total_out`) | 147 | 322 |
| portfolios holding a counted position | 77 | 163 |
| **net principal on Q3's basis** | **372,441,450** (~$372) | **15,894,644,324,814** (~$15.89M) |
| net principal over *all* positions, quarantined included | 308,689,429 (~$309) | 15,853,230,013,474 (~$15.85M) |
| gross in / out | 1,907,976,143 / 1,599,286,714 | 27,205,990,201,853 / 11,352,760,188,379 |
| denom | `ibc/FE98…76A9` (USDC) | same |
| newest `updated_height` | 27,385,904 (head) | 27,378,356 |
| oldest `updated_height` | 22,062,329 | 21,946,152 |
| flows by month | May 19, Jun 28, Sep 75 | May 83, Jun 57, Sep 64 |

Both were updated within hours of each other at chain head, both have flows in every month we have
coverage for, and `ymax1`'s oldest update *precedes* `ymax0`'s — so `ymax0` is not “the one after”.
Both portfolio id namespaces start at `portfolio0`, so `portfolio101` exists in both and means two
different things.

Same denom and decimals for both, so the ~43,000× principal gap is real and not a units artifact.
`ymax0` carries roughly **$372** of net principal against `ymax1`'s **$15.89M**, on a comparable
number of portfolios — the profile of a canary or staging deployment kept alive on mainnet, not of a
product.

> **Which principal figure.** An earlier draft of this table reported Σ(`total_in` − `total_out`) over
> *all* positions. That is not the number Q3 shows: `ymaxQueries.ts` builds `byVenue` under
> `WHERE total_in >= total_out`, quarantining positions whose outflow exceeds their inflow and
> reporting them separately. Since this section exists to advise a **presentation** decision about
> Q3's headline, the table now leads with Q3's own basis and keeps the unfiltered sum beneath it for
> comparison. Note the direction: quarantined rows carry negative principal, so including them
> *understated* both contracts — ymax0 by about $63. Raised by the reviewer on #14 and reproduced;
> both sets of figures are correct for what they measure, and the two counts of “portfolios” are
> different measures too (111/266 are portfolios ever created, matching the vstorage children exactly;
> 77/163 are those holding a counted position).

**Good news on data integrity:** `ymax_portfolio`, `ymax_position` and `ymax_flow` are all keyed by
`(contract, portfolio, …)`, so the two never collide in storage. The one place the contract is lost
is the `invoke_target` series, whose dimensions are bare (`delegate-portfolio101`,
`portfolioMandate-portfolio102`), so ymax0 and ymax1 portfolios with the same number merge there.

**Recommendation.** Not an annotation about continuity — there is no boundary to annotate. And not
exclusion either: ymax0 is real deployed capital, Q3 asks how much capital is deployed through
orchestration, so the **sum answers the question correctly** and dropping a venue for being small
would invert the project's own principle. The defect is purely presentational — two deployments at
~43,000× different scale rendered as one number, with no way for a reader to notice when the small
one moves.

So: keep the headline as the sum, and **surface the per-contract split beside it**. `byVenue` already
carries a `contract` column, so this is an aside in the existing payload rather than new data. The
headline keeps meaning exactly what it says, and the moment ymax0 stops being dust the reader sees
it. (This framing is the reviewer's on #14, and it is better than the split-or-exclude options this
document first proposed.)

---

## The 16-action offset on the floor day — a split floor, not a stray rebuild

**Corrected.** An earlier draft of this document read this as a category rebuild writing rows the
base indexer never recorded, “plausibly a test run”. That diagnosis was **inverted**, as the
designated reviewer pointed out on #14. The hour-level data says the opposite, and the arithmetic
closes exactly.

Every hour of 2026-05-30, from `hourly_metrics` (production, read-only):

| Hour (UTC) | `offer_category` | `wallet_actions` | `offer_source` | `offer_outcome_category` | `offer_outcome` | `tx_success` |
|---|---|---|---|---|---|---|
| 00 | 1 | 0 | 0 | 1 | 0 | 26 |
| 01 | 2 | 0 | 0 | 0 | 0 | 26 |
| 02 | 0 | 0 | 0 | 0 | 0 | 25 |
| 03 | 0 | 0 | 0 | 0 | 0 | 33 |
| 04 | 6 | 0 | 0 | 2 | 0 | 28 |
| 05 | 7 | 0 | 0 | 7 | 0 | 35 |
| 06 | 0 | 0 | 0 | 0 | 0 | 15 |
| **07** | 1 | **1** | **1** | 1 | **1** | 23 |
| 08 | 8 | 8 | 6 | 6 | 6 | 37 |
| 12 | 3 | 3 | 3 | — | — | 29 |

The two families have **different start times inside the same UTC day**:

- **Rebuild-derived** — `offer_category`, `offer_outcome_category` — start at **00:00**.
- **Base-indexer** — `wallet_actions`, `offer_source`, `offer_outcome` — start at **07:00**.

From 07:00 onward every series agrees exactly. A spurious rebuild would not stop cleanly at 07:00 and
then match perfectly for 106 days; a series that simply *starts* at 07:00 does. And both totals fall
out of the table with no remainder:

- `offer_category` − `wallet_actions` = 4,433 − 4,417 = **16** = 1 + 2 + 6 + 7, the pre-07:00 hours.
- `offer_outcome_category` − `offer_outcome` = 2,667 − 2,657 = **10** = 1 + 2 + 7, likewise.

So `offer_category` is not 16 ahead. **`wallet_actions` is missing its first seven hours**, and the
rebuild-derived series are the *more* complete of the two at the floor. The 16 are real offers the
base series never recorded. This also sits exactly on the third boundary the brief now records — the
offer-series floor, 2026-05-30, height 25669513 — which is consistent with a floor effect and not
with a stray run.

**One consequence the reviewer drew does not hold.** The review argued that because `offersSeen`
comes from `wallet_actions` (the undercounted side) while settled outcomes do not, `unresolved` is
biased negative in those hours. It is not: `offer_outcome` is a **base-indexer** series and shares the
same 07:00 floor — zero in hours 00–06, first row at 07:00, as the table above shows. Seen and
settled are on the *same* side of the split. The residue for 2026-05-30 is therefore exactly **0**,
and across all history only one day is negative, 2026-06-08 at −1, which is the ordinary windowing
artifact already documented. The negative path still has exactly one cause.

**For Tier 3.4.** The acceptance test is “no other series moved”. Baseline it as a **split floor**,
not as contamination: a full rebuild that starts below 25669513 will legitimately *raise*
`offer_category` relative to today, and re-running the base indexer over 2026-05-30 00:00–07:00 would
legitimately raise `wallet_actions` by 16 and `offer_outcome` by 10. Those are corrections, not
drift, and the acceptance test must not read them as regressions.

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
- **Scope the rebuild to the offer-series floor, not the reporting floor.** The category rebuild must
  cover from height **25669513** (2026-05-30) at the latest, and running it from below that is what
  would close the split-floor gap described above. Scoping it from 2026-01-01 replays four and a half
  months that can never yield offer rows.
- **Baseline Tier 3.4 as a split floor.** “No other series moved” must tolerate `wallet_actions`
  rising by 16 and `offer_outcome` by 10 if the base indexer is re-run over 2026-05-30 00:00–07:00.
  Those are corrections, not drift.
- **Nothing can start until the end-block backfill finishes.** It is at height 26,041,664 of
  25,498,665–27,169,144 — about 32% through, checkpointed in `backfill_checkpoint` as
  `endblock_ibc_orch`.
