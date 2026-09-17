import { describe, expect, it } from "vitest";
import { SERIES_COVERAGE_FLOORS, coverageFloorFor, isBeforeCoverage } from "@/lib/coverageFloors";
import { SERIES } from "@/lib/semantics";

/**
 * First hourly bucket observed for each series, captured from production on 2026-09-17 with
 * `select series, min(hour) from hourly_metrics group by 1`.
 *
 * This is the ONLY place derivation from the data appears. It is the drift guard's observed side —
 * never the read path's source of truth. A declared floor must be no later than the bucket that
 * holds the first real row, or the read path would blank indexed data.
 */
const OBSERVED_FIRST_HOUR: Readonly<Record<string, string>> = {
  bank_credits_volume: "2026-01-01T00:00:00.000Z",
  fee_paid: "2026-01-01T00:00:00.000Z",
  gas_used: "2026-01-01T00:00:00.000Z",
  tx_success: "2026-01-01T00:00:00.000Z",
  ibc_transfer_amount_out: "2026-01-01T02:00:00.000Z",
  ibc_transfer_out_count: "2026-01-01T02:00:00.000Z",
  transfer_volume: "2026-01-01T02:00:00.000Z",
  ibc_transfer_amount_in: "2026-01-01T03:00:00.000Z",
  ibc_transfer_flow_in: "2026-01-01T03:00:00.000Z",
  ibc_transfer_in_count: "2026-01-01T03:00:00.000Z",
  tx_failed: "2026-01-01T08:00:00.000Z",
  ibc_transfer_amount_out_orch: "2026-05-19T02:00:00.000Z",
  ibc_transfer_out_count_orch: "2026-05-19T02:00:00.000Z",
  offer_category: "2026-05-30T00:00:00.000Z",
  offer_outcome_category: "2026-05-30T00:00:00.000Z",
  block_gas_limit: "2026-05-30T06:00:00.000Z",
  gas_wanted: "2026-05-30T06:00:00.000Z",
  offer_maker: "2026-05-30T07:00:00.000Z",
  offer_outcome: "2026-05-30T07:00:00.000Z",
  offer_source: "2026-05-30T07:00:00.000Z",
  wallet_actions: "2026-05-30T07:00:00.000Z",
  invoke_target: "2026-05-30T08:00:00.000Z",
  staking_delegations: "2026-05-30T09:00:00.000Z",
  staking_undelegations: "2026-05-30T13:00:00.000Z",
  staking_redelegations: "2026-05-31T05:00:00.000Z",
  offer_give_volume: "2026-06-01T14:00:00.000Z",
  offer_instance: "2026-06-01T14:00:00.000Z",
  offer_payout_volume: "2026-06-01T14:00:00.000Z",
  offer_want_volume: "2026-06-01T14:00:00.000Z",
  gov_proposals: "2026-07-22T10:00:00.000Z",
  gov_votes: "2026-07-22T10:00:00.000Z",
};

describe("SERIES_COVERAGE_FLOORS — drift guard", () => {
  // Direction 1: nothing undeclared. An undeclared series would fall silently outside the
  // read-path contract instead of failing here. This is the direction that catches a NEW series.
  it("declares a floor for every series the indexer writes", () => {
    const declared = Object.keys(SERIES_COVERAGE_FLOORS).sort();
    const known = Object.values(SERIES).sort();
    expect(declared).toEqual(known);
    expect(declared).toHaveLength(31);
  });

  it("declares nothing that is not a real series", () => {
    const known = new Set<string>(Object.values(SERIES));
    for (const s of Object.keys(SERIES_COVERAGE_FLOORS)) expect(known.has(s)).toBe(true);
  });

  // Direction 2: no floor later than the first real row, or the read path blanks indexed data.
  // Compared at hour granularity, because a floor may fall inside the bucket that holds that row.
  it("declares no floor later than the bucket holding that series' first observed row", () => {
    for (const [series, firstHour] of Object.entries(OBSERVED_FIRST_HOUR)) {
      expect(coverageFloorFor(series), `${series} is undeclared`).not.toBeNull();
      expect(isBeforeCoverage(series, firstHour, "hour"), `${series} would blank its own first row`).toBe(false);
    }
  });

  it("covers every observed series, and observes every declared one", () => {
    expect(Object.keys(OBSERVED_FIRST_HOUR).sort()).toEqual(Object.keys(SERIES_COVERAGE_FLOORS).sort());
  });

  it("records a checkable provenance for every floor", () => {
    for (const [series, floor] of Object.entries(SERIES_COVERAGE_FLOORS)) {
      expect(Number.isFinite(Date.parse(floor.from)), `${series} has an unparseable floor`).toBe(true);
      expect(floor.source.length).toBeGreaterThan(10);
    }
  });
});

describe("isBeforeCoverage", () => {
  it("does NOT blank a genuine zero after the floor — the gov_proposals case", () => {
    // gov_proposals has been written since 2026-05-30 but its first row is 2026-07-22, because the
    // chain had no proposal between 118 (2026-03-30) and 119 (2026-07-22). Those 53 days are
    // observed zero, and a floor derived from the first row would discard them as unknown.
    expect(isBeforeCoverage("gov_proposals", "2026-06-15", "day")).toBe(false);
    expect(isBeforeCoverage("gov_proposals", "2026-07-21", "day")).toBe(false);
    // Before the floor it really is unknown.
    expect(isBeforeCoverage("gov_proposals", "2026-05-29", "day")).toBe(true);
  });

  it("treats a bucket CONTAINING the floor as covered, not blank", () => {
    // The base indexer's first block is 2026-05-30T06:51:13Z. The 06:00 hour holds 96 real blocks,
    // so blanking it would discard indexed data.
    expect(isBeforeCoverage("wallet_actions", "2026-05-30T06:00:00.000Z", "hour")).toBe(false);
    expect(isBeforeCoverage("wallet_actions", "2026-05-30T05:00:00.000Z", "hour")).toBe(true);
    expect(isBeforeCoverage("wallet_actions", "2026-05-30", "day")).toBe(false);
    expect(isBeforeCoverage("wallet_actions", "2026-05-29", "day")).toBe(true);
  });

  it("separates the two writers that share a first day", () => {
    // The category rebuild ran from 00:00:05; the base indexer only from 06:51:13. On the 00:00
    // hour of 2026-05-30 the category series are covered and the base series are not.
    expect(isBeforeCoverage("offer_category", "2026-05-30T00:00:00.000Z", "hour")).toBe(false);
    expect(isBeforeCoverage("wallet_actions", "2026-05-30T00:00:00.000Z", "hour")).toBe(true);
  });

  it("blanks buckets before the Cosmos-level and orchestration floors", () => {
    expect(isBeforeCoverage("tx_success", "2025-12-31", "day")).toBe(true);
    expect(isBeforeCoverage("tx_success", "2026-01-01", "day")).toBe(false);
    expect(isBeforeCoverage("ibc_transfer_amount_out_orch", "2026-05-18", "day")).toBe(true);
    expect(isBeforeCoverage("ibc_transfer_amount_out_orch", "2026-05-19", "day")).toBe(false);
    // The non-orch sibling is covered four and a half months earlier — the wildcard collision that
    // enumerating the map removed.
    expect(isBeforeCoverage("ibc_transfer_amount_out", "2026-05-18", "day")).toBe(false);
  });

  it("handles week buckets by their UTC Monday", () => {
    // Week of 2026-05-25 (Monday) contains 2026-05-30, so the base indexer's floor falls inside it.
    expect(isBeforeCoverage("wallet_actions", "2026-05-25", "week")).toBe(false);
    expect(isBeforeCoverage("wallet_actions", "2026-05-18", "week")).toBe(true);
  });

  it("fails open for an undeclared series rather than blanking it", () => {
    expect(isBeforeCoverage("not_a_series", "2020-01-01", "day")).toBe(false);
    expect(coverageFloorFor("not_a_series")).toBeNull();
  });

  it("ignores an unparseable bucket label rather than blanking it", () => {
    expect(isBeforeCoverage("wallet_actions", "not-a-date", "day")).toBe(false);
  });
});
