# P8 Tier 3.4 — offer-category rebuild, run record

Operational record of the category rebuild. It exists because the rebuild leaves nothing behind in
the repository except a checkpoint number: anyone finding `offer_categories @ 27404585` later has no
way to tell a planned rebuild from something that went wrong. Raised in review, and a fair gap.

## What ran

| | |
|---|---|
| Script | `scripts/backfillOfferCategories.ts`, FULL mode |
| Code | `main` @ `9a60f7f` (PR #18 — the two audited maker rules) |
| Started | 2026-09-18 ≈06:40Z |
| Finished | 2026-09-19 06:37:52Z — **32,912 s (9.1 h)**, exit 0 |
| Range | heights **25669513 → 27404585**, 1,735,073 blocks |
| Concurrency | 12 |
| Checkpoint left | `offer_categories = 27404585` |
| Failures | **0** exhausted retries. The archive rate-limited (HTTP 429) throughout and every request was retried or served by the fallback |

```bash
DATABASE_URL=… RPC_URL=https://main-a.rpc.agoric.net \
RPC_URL_FALLBACK=https://agoric-rpc.polkachu.com \
INDEXER_START_DATE=2026-05-30T00:00:00Z \
BACKFILL_CONCURRENCY=12 \
caffeinate -i npx tsx scripts/backfillOfferCategories.ts
```

**`INDEXER_START_DATE` is load-bearing.** FULL mode refuses `BACKFILL_FROM_HEIGHT` — it must replay
the whole window — so the start date alone sets the range. `2026-05-30T00:00:00Z` reproduces
`offer_category`'s existing floor (height 25669513). Using the orchestration backfill's date
(`2026-05-19T01:52:00Z`) would have extended the series eleven days below where the base indexer ever
ran, putting eleven days of categorized actions with no matching `wallet_actions` inside Q2's
denominator — the split-floor discrepancy widened from seven hours to eleven days.

## Result

| Category | before | after | Δ |
|---|---|---|---|
| `fast_usdc` | 2,024 | **2,470** | +446 |
| `ymax` | 543 | **606** | +63 |
| `other` | 570 | **61** | −509 |
| `orchestration` | 1,263 | 1,263 | 0 |
| `psm` | 48 | 48 | 0 |
| **total** | **4,448** | **4,448** | **0** |

Total unchanged: the rules move actions between categories, they do not create any.

On production, complete days: unclassified **12.8% → 1.4%**, user-initiated **13.3% → 14.5%**,
stated bound **13.3–26.1% → 14.5–15.9%**. The honest range narrowed from 12.8 points to 1.4.

### The residual 61, fully accounted

| Source | Count |
|---|---|
| `Withdraw` | 31 |
| `Deposit` | 19 |
| `makeWithdrawInvitation` | 6 |
| `makeOpenPortfolioInvitation` | 2 |
| `makeDepositInvitation` | 1 |
| Offers carrying neither a resolvable instance nor a maker | 2 |

`Withdraw` and `Deposit` (50 of the 61) cannot be classified by name:
`LocalOrchestrationAccount` publishes `invitationMakers` with those names, so any contract handing
out that facet — Fast-USDC among them here — produces offers with the same maker string. See
`src/lib/offerCategory.ts`. Closing them needs seat lineage
(`invitationSpec.previousOffer`, decoded in `walletOfferSummary.ts` and currently discarded), which
is indexer work rather than a rule.

## Acceptance test — passed

**Control series byte-identical.** The rebuild writes only `offer_category`,
`offer_outcome_category` and `offer_category_participant_day`; nothing else may move:

```
wallet_actions 4432 · offer_source 2672 · offer_maker 2630
offer_instance 88 · invoke_target 1759 · offer_outcome 2665     — all unchanged
```

`tx_success`, `gas_used`, `fee_paid` and `block_gas_limit` did move. Those are written every block by
the live indexer and 9.1 hours elapsed; unrelated to the rebuild.

**Coverage floors unchanged**, and the distinction matters here as much as anywhere:

| Series | Declared floor (`coverageFloors.ts`) | First observed row |
|---|---|---|
| `offer_category` | 2026-05-30T00:00:05Z, h25669513 | 2026-05-30 00:00 |
| `wallet_actions` | **2026-05-30T06:51:13Z, h25673978** | 2026-05-30 07:00 |

Both are unchanged by the rebuild. `wallet_actions`' 07:00 is the hour of the first wallet *action*;
its coverage begins at 06:51:13Z, nine minutes earlier, which is when the base indexer wrote its
first block. Calling 07:00 the floor is the observed-versus-declared conflation this project spent a
whole phase dismantling — and an earlier draft of this very document did exactly that, which is why
the table is here rather than a sentence.

No `offer_category` row exists before 2026-05-30 (verified: 0 rows), so the `INDEXER_START_DATE`
hazard above did not occur. The documented split-floor offsets survive exactly:
`offer_category − wallet_actions = 16`, `offer_outcome_category − offer_outcome = 10`. Drift guard
and rule tests pass (38 tests).

**No double-count in the overlap window.** The FULL-mode delete ran at the start and the live
indexer kept writing for the whole 9.1 hours, so the two could in principle both have written the
same buckets — additive writes double-count silently, which is this repository's standing hazard.
Per day across the boundary, `offer_category` against `wallet_actions` and `offer_outcome_category`
against `offer_outcome`:

```
2026-09-17   32 / 32   diff 0      18 / 18   diff 0
2026-09-18   14 / 14   diff 0       8 /  8   diff 0     <- delete + replay + live writes
2026-09-19   11 / 11   diff 0       8 /  8   diff 0     <- run finished 06:38Z
2026-09-20   10 / 10   diff 0       7 /  7   diff 0
```

Raised by the reviewer, whose own acceptance check stopped at 2026-09-17 and so had not covered the
overlap; reproduced here independently.

### Where the prediction was off

Predicted `fast_usdc` 2,468 and `other` 63; actual 2,470 and 61 — **two actions, 0.045%**. Maker
counts are unchanged (`SubmitEvidence` 444, `SimpleRebalance` 63), so it is not new activity. The
prediction was a point-in-time snapshot of a pre-rebuild state that was itself a *mixture* — rows
from the previous rebuild plus rows the live indexer had written since, across a boundary that kept
moving for 9.1 hours. Everything structurally predictable landed exactly: `ymax` +63, total
unchanged, controls frozen.

## One operational note

A run was started and killed about a minute in, before this one. The startup routine
(`findEarliestQueryableHeight`) binary-searches from height 1, and the archive answers genesis-era
heights with a generic `Internal error` — twelve such lines before the range banner. That was
misread as the pruned-fallback hazard the brief warns about and the run was stopped.

It was a false alarm: `backfillOfferCategories.ts:125` already treats a null block as a failed
attempt so the retry returns to the archive, exactly as the brief requires. The FULL-mode delete had
already run, so the only cost was a few minutes with the category series empty. **Those `Internal
error` lines at startup are expected and benign.**

## Not done, and deliberately

**3.1 changed nothing.** `agoricNames.json` was refreshed against mainnet and came back identical —
41 instances, 22 brands, 18 vbank assets, no Board id added, removed or renamed since 2026-05-30;
only `generatedAt` moved. The brief's premise for that step (contracts redeployed since, no longer
resolving) did not hold in this window. The nine hours bought 3.2, not 3.1.

**3.3 has not fired live.** The decay signal is deployed and silent. Confirmed silent-because-clean
rather than broken: no unclassified-maker action has occurred since the deploy — the last `Withdraw`
was 2026-09-06. The per-interval drain is why it is quiet; a cumulative counter would still be
reporting September. Worth a glance the first time a `Deposit` or `Withdraw` offer lands.
