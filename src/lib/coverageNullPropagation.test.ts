import { describe, expect, it } from "vitest";
import { isBeforeCoverage } from "@/lib/coverageFloors";
import { buildGasUtilizationRows } from "@/lib/gasUtilizationSeries";
import { buildStakingGovActivityRows } from "@/lib/stakingGovActivitySeries";
import { buildSuccessRateRows } from "@/lib/successRateSeries";
import { linearTrendLine } from "@/lib/linearTrend";

/**
 * End-to-end check that a coverage gap SURVIVES the whole read path.
 *
 * The per-unit tests each cover one hop. This covers the composition, because that is where the
 * failures actually were: `values.x!` stripped the null a widened type had just introduced, `?? 0`
 * swallowed an emitted null, and `?? NaN` destroyed the null the trend line needs. Every one of
 * those typechecked and passed the unit tests of the function around them.
 *
 * `emit` reproduces what `seriesOverTime` does, so these rows are the shape the charts receive.
 */
function emit(series: string, buckets: readonly string[], valueByBucket: Record<string, string>) {
  return buckets.map((bucket) => ({
    bucket,
    value: isBeforeCoverage(series, bucket, "day") ? null : valueByBucket[bucket] ?? "0",
  }));
}

/** 2026-01-02 is covered for Cosmos-level series and NOT for base-indexer ones; 2026-06-02 is both. */
const DAYS = ["2026-01-02", "2026-06-02"] as const;

describe("a coverage gap survives to the chart rows", () => {
  it("emits null before the floor and a real value after it", () => {
    expect(emit("gas_used", DAYS, { "2026-01-02": "5", "2026-06-02": "7" })).toEqual([
      { bucket: "2026-01-02", value: "5" },
      { bucket: "2026-06-02", value: "7" },
    ]);
    // gas_wanted is written by the base indexer, so January is not covered at all.
    expect(emit("gas_wanted", DAYS, { "2026-06-02": "4" })).toEqual([
      { bucket: "2026-01-02", value: null },
      { bucket: "2026-06-02", value: "4" },
    ]);
  });

  it("does not invent a gas ratio from a covered numerator and an uncovered denominator", () => {
    // The real January shape: gas_used exists (Cosmos backfill) while gas_wanted and
    // block_gas_limit do not (base indexer). A ratio here would be fabricated, and printing 0%
    // would claim the chain used none of its block space.
    const rows = buildGasUtilizationRows(
      emit("gas_used", DAYS, { "2026-01-02": "50", "2026-06-02": "50" }),
      emit("gas_wanted", DAYS, { "2026-06-02": "100" }),
      emit("block_gas_limit", DAYS, { "2026-06-02": "200" })
    );
    expect(rows[0]).toEqual({ bucket: "2026-01-02", gasEfficiencyPct: null, blockGasUtilizationPct: null });
    expect(rows[1]!.gasEfficiencyPct).toBeCloseTo(50);
    expect(rows[1]!.blockGasUtilizationPct).toBeCloseTo(25);
  });

  it("keeps success-rate counts and the rate null where uncovered", () => {
    // tx_success and tx_failed share the Cosmos floor, so force the uncovered case explicitly.
    const rows = buildSuccessRateRows(
      [{ bucket: "a", value: null }, { bucket: "b", value: "90" }],
      [{ bucket: "a", value: null }, { bucket: "b", value: "10" }]
    );
    expect(rows[0]).toEqual({ bucket: "a", successful: null, failed: null, successRatePct: null });
    expect(rows[1]).toMatchObject({ successful: 90, failed: 10 });
    expect(rows[1]!.successRatePct).toBeCloseTo(90);
  });

  it("keeps a half-covered success bucket from producing a rate", () => {
    const rows = buildSuccessRateRows([{ bucket: "a", value: "5" }], [{ bucket: "a", value: null }]);
    expect(rows[0]!.successRatePct).toBeNull();
  });

  it("keeps staking and governance counts null before their floor", () => {
    const rows = buildStakingGovActivityRows({
      delegations: emit("staking_delegations", DAYS, { "2026-06-02": "3" }),
      undelegations: emit("staking_undelegations", DAYS, { "2026-06-02": "1" }),
      redelegations: emit("staking_redelegations", DAYS, {}),
      govVotes: emit("gov_votes", DAYS, {}),
      govProposals: emit("gov_proposals", DAYS, {}),
    });
    expect(rows[0]).toEqual({
      bucket: "2026-01-02",
      delegations: null,
      undelegations: null,
      redelegations: null,
      govVotes: null,
      govProposals: null,
    });
    // After the floor a zero is a real observation and must NOT be blanked — this is the
    // gov_proposals case that makes floors declared rather than derived.
    expect(rows[1]).toEqual({
      bucket: "2026-06-02",
      delegations: 3,
      undelegations: 1,
      redelegations: 0,
      govVotes: 0,
      govProposals: 0,
    });
  });

  it("does not draw a trend across the gap", () => {
    const counts = buildStakingGovActivityRows({
      delegations: emit("staking_delegations", DAYS, { "2026-06-02": "3" }),
      undelegations: emit("staking_undelegations", DAYS, {}),
      redelegations: emit("staking_redelegations", DAYS, {}),
      govVotes: emit("gov_votes", DAYS, {}),
      govProposals: emit("gov_proposals", DAYS, {}),
    }).map((r) => r.delegations);
    const trend = linearTrendLine(counts);
    expect(trend[0]).toBeNull();
    expect(trend[1]).not.toBeNull();
  });
});
