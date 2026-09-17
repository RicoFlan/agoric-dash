/**
 * Per-series coverage floors: the instant each rollup series began being written.
 *
 * The dashboard has ONE reporting floor (`INDEXED_HISTORY_FROM_DAY`, 2026-01-01) but the data has
 * four, because different series were written by different jobs starting at different heights. A
 * request for a day before a series' floor gets no rows, and the read path's `?? 0` turns that into
 * a zero — so "we did not index this" renders identically to "this did not happen". That is the
 * defect this module exists to remove.
 *
 * **Floors are DECLARED here, never derived from the data.** A first-row rule cannot tell *no
 * activity* from *no coverage*, and would blank days we positively know to be zero. The proof is
 * `gov_proposals`: its first row is 2026-07-22, but it has been written since 2026-05-30, and the
 * chain's proposals are 118 on 2026-03-30 then 119 on 2026-07-22 — so 2026-05-30 to 2026-07-21 is
 * 53 days of *observed* zero. Deriving the floor from the first row would discard that. Derivation
 * appears in the drift-guard test only (coverageFloors.contract.test.ts), never in the read path.
 *
 * Floors are instants, not days, because two of them fall mid-day and one of those lands on the day
 * the whole distinction matters. Enumerated with no wildcards: an earlier draft grouped the IBC
 * series under `ibc_transfer_*`, which also matches the two orchestration series declared four and a
 * half months later, so a pattern lookup returned a different floor depending on match order.
 */
import { SERIES } from "@/lib/semantics";

/** Height whose block time is a floor, recorded so each floor is checkable against the chain. */
export interface CoverageFloor {
  /** First instant covered, ISO-8601 UTC. */
  readonly from: string;
  /** Block height that instant is the timestamp of, when the floor came from a known height. */
  readonly height: number | null;
  /** How this floor was established. */
  readonly source: string;
}

/**
 * The four writers, and when each began.
 *
 * - **Cosmos-level backfill** — ran below the indexer's own start, back to the reporting floor.
 * - **Orchestration backfill** — `INDEXER_START_DATE=2026-05-19T01:52:00Z`, height 25498665.
 * - **Category rebuild** — height 25669513, block time 2026-05-30T00:00:05Z. Writes the two
 *   category series only, which is why they are six hours more complete than the base indexer's on
 *   their shared first day.
 * - **Base indexer** — height 25673978, block time 2026-05-30T06:51:13Z. Verified against the chain:
 *   `block_gas_limit` is written once per block unconditionally, and its first hourly bucket
 *   (2026-05-30 06:00) holds 11,520,000,000 ÷ 120,000,000 = 96 blocks, ending at height 25674073
 *   (06:59:57Z). 96 blocks back from there is 25673978. Note this is NOT 07:00 — that is merely when
 *   the first *wallet action* happened to occur, which is a fact about the chain, not about coverage.
 */
const COSMOS_BACKFILL: CoverageFloor = {
  from: "2026-01-01T00:00:00Z",
  height: null,
  source: "Cosmos-level backfill, run below the indexer start to the reporting floor",
};

const ORCHESTRATION_BACKFILL: CoverageFloor = {
  from: "2026-05-19T01:52:00Z",
  height: 25498665,
  source: "End-block orchestration backfill start (INDEXER_START_DATE)",
};

const CATEGORY_REBUILD: CoverageFloor = {
  from: "2026-05-30T00:00:05Z",
  height: 25669513,
  source: "Offer-category rebuild start",
};

const BASE_INDEXER: CoverageFloor = {
  from: "2026-05-30T06:51:13Z",
  height: 25673978,
  source: "Base indexer's first written block",
};

/**
 * Every series in `daily_metrics` / `hourly_metrics`, enumerated. The contract test asserts this
 * covers `SERIES` exhaustively — an undeclared series would otherwise fall silently outside the
 * read-path contract instead of failing loudly.
 */
export const SERIES_COVERAGE_FLOORS: Readonly<Record<string, CoverageFloor>> = {
  // --- Cosmos-level: backfilled below the indexer start ---
  [SERIES.TX_SUCCESS]: COSMOS_BACKFILL,
  [SERIES.TX_FAILED]: COSMOS_BACKFILL,
  [SERIES.GAS_USED]: COSMOS_BACKFILL,
  [SERIES.FEE_PAID]: COSMOS_BACKFILL,
  [SERIES.TRANSFER_VOLUME]: COSMOS_BACKFILL,
  [SERIES.BANK_CREDITS_VOLUME]: COSMOS_BACKFILL,
  [SERIES.IBC_TRANSFER_OUT_COUNT]: COSMOS_BACKFILL,
  [SERIES.IBC_TRANSFER_IN_COUNT]: COSMOS_BACKFILL,
  [SERIES.IBC_TRANSFER_FLOW_IN]: COSMOS_BACKFILL,
  [SERIES.IBC_TRANSFER_AMOUNT_OUT]: COSMOS_BACKFILL,
  [SERIES.IBC_TRANSFER_AMOUNT_IN]: COSMOS_BACKFILL,

  // --- End-block orchestration: its own backfill, from the indexer start height ---
  [SERIES.IBC_TRANSFER_AMOUNT_OUT_ORCH]: ORCHESTRATION_BACKFILL,
  [SERIES.IBC_TRANSFER_OUT_COUNT_ORCH]: ORCHESTRATION_BACKFILL,

  // --- Category rebuild: six hours ahead of the base indexer on their shared first day ---
  [SERIES.OFFER_CATEGORY]: CATEGORY_REBUILD,
  [SERIES.OFFER_OUTCOME_CATEGORY]: CATEGORY_REBUILD,

  // --- Base indexer: everything message-decoded, plus the per-block gas witnesses ---
  [SERIES.WALLET_ACTIONS]: BASE_INDEXER,
  [SERIES.OFFER_SOURCE]: BASE_INDEXER,
  [SERIES.OFFER_INSTANCE]: BASE_INDEXER,
  [SERIES.OFFER_MAKER]: BASE_INDEXER,
  [SERIES.OFFER_OUTCOME]: BASE_INDEXER,
  [SERIES.OFFER_GIVE_VOLUME]: BASE_INDEXER,
  [SERIES.OFFER_WANT_VOLUME]: BASE_INDEXER,
  [SERIES.OFFER_PAYOUT_VOLUME]: BASE_INDEXER,
  [SERIES.INVOKE_TARGET]: BASE_INDEXER,
  [SERIES.GOV_PROPOSALS]: BASE_INDEXER,
  [SERIES.GOV_VOTES]: BASE_INDEXER,
  [SERIES.STAKING_DELEGATIONS]: BASE_INDEXER,
  [SERIES.STAKING_UNDELEGATIONS]: BASE_INDEXER,
  [SERIES.STAKING_REDELEGATIONS]: BASE_INDEXER,
  [SERIES.BLOCK_GAS_LIMIT]: BASE_INDEXER,
  [SERIES.GAS_WANTED]: BASE_INDEXER,
} as const;

/** The declared floor for a series, or null when the series is not declared (see the contract test). */
export function coverageFloorFor(series: string): CoverageFloor | null {
  return SERIES_COVERAGE_FLOORS[series] ?? null;
}

/** Length of one bucket, in milliseconds, by granularity. Week buckets are labelled by UTC Monday. */
const BUCKET_MS: Readonly<Record<"hour" | "day" | "week", number>> = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
};

/**
 * Parse a bucket label to its start instant. Two shapes occur in this codebase and both are handled:
 * day and week buckets are `YYYY-MM-DD`, hour buckets are a full ISO string with milliseconds
 * (`2026-05-30T06:00:00.000Z`, from `hourKeyFromDate`). Returns NaN for anything unparseable.
 */
function bucketStartMs(bucket: string): number {
  return Date.parse(bucket.length === 10 ? `${bucket}T00:00:00.000Z` : bucket);
}

/**
 * True when `bucket` lies ENTIRELY before the series' declared coverage — the case where a stored
 * zero means "never indexed", and the read path must report nothing rather than 0.
 *
 * Compared as instants, never as strings. Two of the four floors fall mid-day, and one of those
 * lands inside an hour bucket that does hold real rows, so a bucket containing its floor counts as
 * covered: blanking it would discard indexed data to avoid implying coverage we do have. String
 * comparison would also be outright wrong here — `"...T06:00:00.000Z" < "...T06:00:00Z"` is true,
 * because `.` sorts below `Z`, so the covered 06:00 bucket would be blanked.
 *
 * A series with no declared floor is treated as covered. Failing open keeps an undeclared series
 * visible; the contract test is what makes "undeclared" impossible, rather than silent blanking.
 */
export function isBeforeCoverage(series: string, bucket: string, granularity: "hour" | "day" | "week"): boolean {
  const floor = coverageFloorFor(series);
  if (!floor) return false;
  const start = bucketStartMs(bucket);
  if (!Number.isFinite(start)) return false;
  return start + BUCKET_MS[granularity] <= Date.parse(floor.from);
}
