import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/coingecko/simplePrice", () => ({ getUsdSpotPrices: async () => ({ usdByCoinId: {}, fetchedAtIso: null, partialOrStale: false }) }));

import { DailyPriceTable } from "@/lib/denomPrices";
import type { EnrichedDisplay } from "@/lib/metricsDisplayTypes";
import type { DayBucketMap } from "@/lib/organicActivity";
import { buildQuestions, delta } from "@/lib/questionsPayload";
import { SERIES } from "@/lib/semantics";

const display: EnrichedDisplay = { metas: { ubld: { displaySymbol: "BLD", decimals: 6 } } };
const denomToCoinId = new Map([["ubld", "agoric"]]);
const D = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"] as const;

/** Context: 08-01..08-04; prior window 08-01..08-02; range 08-03..08-04. */
function ctx(): DayBucketMap {
  const day = (tx: number, failed: number, feeUbld: number, cats: Record<string, number>, ibcIn: number) =>
    new Map<string, Map<string, bigint>>([
      [SERIES.TX_SUCCESS, new Map([["", BigInt(tx)]])],
      [SERIES.TX_FAILED, new Map([["", BigInt(failed)]])],
      [SERIES.FEE_PAID, new Map([["ubld", BigInt(feeUbld)]])],
      [SERIES.OFFER_CATEGORY, new Map(Object.entries(cats).map(([c, n]) => [c, BigInt(n)]))],
      [SERIES.IBC_TRANSFER_AMOUNT_IN, new Map([["ubld", BigInt(ibcIn)]])],
      [SERIES.OFFER_OUTCOME_CATEGORY, new Map([["vaults|wants_satisfied", BigInt(3)], ["vaults|errored", BigInt(1)]])],
    ]);
  return new Map([
    [D[0], day(100, 0, 1_000_000, { vaults: 1, oracle: 9 }, 1_000_000)],
    [D[1], day(100, 0, 1_000_000, { vaults: 1, oracle: 9 }, 1_000_000)],
    [D[2], day(150, 50, 3_000_000, { vaults: 5, oracle: 5 }, 4_000_000)],
    [D[3], day(150, 50, 3_000_000, { vaults: 5, oracle: 5 }, 0)],
  ]);
}

function feeByDay() {
  const legs = (m: Record<string, number>) => new Map(Object.entries(m).map(([a, n]) => [a, new Map([["ubld", BigInt(n)]])]));
  return new Map([
    [D[0], legs({ a: 1_000_000, b: 1_000_000 })], // 2 equal payers → effective N 2
    [D[1], legs({ a: 1_000_000, b: 1_000_000 })],
    [D[2], legs({ a: 1_000_000, b: 1_000_000, c: 1_000_000, d: 1_000_000 })], // 4 equal → 4
    [D[3], legs({ a: 1_000_000, b: 1_000_000, c: 1_000_000, d: 1_000_000 })],
  ]);
}

function build() {
  const table = new DailyPriceTable(new Map([["agoric", new Map(D.map((d) => [d, 1]))]]), D[0], D[3], D[3]);
  const dailyContext = ctx();
  return buildQuestions({
    fromDay: D[2],
    toDay: D[3],
    prevFromDay: D[0],
    prevToDay: D[1],
    contextFromDay: D[0],
    dailyContext,
    curBuckets: dailyContext,
    display,
    denomToCoinId,
    table,
    distinctUnionPerDay: [
      { day: D[0], count: 10 },
      { day: D[2], count: 30 },
      { day: D[3], count: 50 },
    ],
    retention: { current: { active: 40, retained: 10, newAddresses: 20 }, previous: { active: 10, retained: 5, newAddresses: 1 } },
    categoryParticipants: {
      current: { distinctInteractiveWallets: 12, distinctAutomatedWallets: 3, byCategory: { vaults: 12, oracle: 3 }, available: true },
      previous: { distinctInteractiveWallets: 8, distinctAutomatedWallets: 3, byCategory: { vaults: 8, oracle: 3 }, available: true },
    },
    feeByDay: feeByDay(),
    ymax: {
      available: true,
      portfoliosWithPositions: 3,
      portfoliosActive: 2,
      portfoliosTotal: 5,
      byVenue: [
        { contract: "ymax1", protocol: "ERC4626", chain: "Ethereum", denom: "ubld", positions: 4, portfolios: 2, principal: "12000000", latestHeight: "100" },
        { contract: "ymax0", protocol: "Aave", chain: "Avalanche", denom: "ibc/UNMAPPED", positions: 1, portfolios: 1, principal: "5", latestHeight: "90" },
      ],
      flowsInRange: [
        { flowType: "deposit", denom: "ubld", count: 3, amount: "3000000" },
        { flowType: "withdraw", denom: "ubld", count: 1, amount: "1000000" },
        { flowType: "rebalance", denom: null, count: 2, amount: "0" },
      ],
      latestHeight: "100",
    },
    grossUsdHhi: 0.25,
    top10FeeSharePct: 74.5,
    multiDayInRange: 7,
  });
}

describe("questions payload (contract)", () => {
  it("has the four question blocks with stable ids and the shared window metadata", () => {
    const q = build();
    expect(q.contextFromDay).toBe(D[0]);
    expect(q.comparisonWindow).toEqual({ from: D[0], to: D[1] });
    expect(q.anomalyRule).toEqual({ windowDays: 30, minPoints: 7, threshold: 2.5 });
    expect([q.q1.id, q.q2.id, q.q3.id, q.q4.id]).toEqual(["busier", "organic", "value-flow", "base"]);
    for (const block of [q.q1, q.q2, q.q3, q.q4]) {
      expect(block.daily.map((p) => p.day)).toEqual([...D]); // dense over the context
      expect(Array.isArray(block.anomalies)).toBe(true);
    }
  });

  it("Q1: successful txs vs prior window plus support figures", () => {
    const { q1 } = build();
    expect(q1.headline).toEqual({ current: 300, previous: 200, pctChange: 50 });
    expect(q1.support.distinctAccountsPerDayAvg).toEqual({ current: 40, previous: 5, pctChange: 700 }); // missing day counts as 0
    expect(q1.support.failureRatePct.current).toBeCloseTo(25, 9);
    expect(q1.support.failureRatePct.previous).toBe(0);
    expect(q1.support.feePaidBld).toEqual({ current: 6, previous: 2, pctChange: 200 });
  });

  it("Q2: organic ratio in percentage points with counts", () => {
    const { q2 } = build();
    expect(q2.headline).toEqual({ current: 50, previous: 10, deltaPts: 40 });
    expect(q2.counts.current).toEqual({ interactive: 10, automated: 10, other: 0, total: 20 });
    expect(q2.support).toEqual({
      distinctInteractiveWallets: { current: 12, previous: 8, pctChange: 50 },
      distinctAutomatedWallets: { current: 3, previous: 3, pctChange: 0 },
      available: true,
      satisfactionByCategory: [
        { category: "vaults", settled: 8, wantsSatisfied: 6, wantsUnsatisfied: 0, errored: 2, satisfactionRatePct: 75 },
      ],
    });
  });

  it("Q3: net IBC USD, day-priced, with its own pricing meta", () => {
    const { q3 } = build();
    expect(q3.headline).toMatchObject({ netUsd: 4, previousNetUsd: 2, deltaUsd: 2, inUsd: 4, outUsd: null });
    expect(q3.byAsset[0]).toMatchObject({ denom: "ubld", net: "4000000", netUsd: 4 });
    expect(q3.usdPricingMeta.basis).toBe("daily-close");
  });

  it("Q3: orchestrated value is a stock priced at the range end, with flows scoped to the range", () => {
    const { q3 } = build();
    const o = q3.orchestrated;
    expect(o.available).toBe(true);
    expect(o.principalUsd).toBe(12); // 12 BLD @ $1 on D[3]; the unmapped venue contributes nothing
    expect(o.byVenue[0]).toMatchObject({ protocol: "ERC4626", chain: "Ethereum", principalUsd: 12 });
    expect(o.byVenue[1]).toMatchObject({ denom: "ibc/UNMAPPED", principalUsd: null });
    expect(o.netDepositsUsd).toBe(2); // 3 − 1
    expect(o.portfoliosActive).toBe(2);
    expect(o.latestHeight).toBe("100");
  });

  it("Q4: effective number of fee payers, gross effective-N, retention, support", () => {
    const { q4 } = build();
    expect(q4.headline.current).toBeCloseTo(4, 9);
    expect(q4.headline.previous).toBeCloseTo(2, 9);
    expect(q4.headline.pctChange).toBeCloseTo(100, 9);
    expect(q4.effectiveNGross).toBe(4);
    expect(q4.retention.current).toMatchObject({ retainedSharePct: 25, newSharePct: 50 });
    expect(q4.retention.retainedShareDeltaPts).toBe(-25);
    expect(q4.support).toEqual({ top10FeeSharePct: 74.5, multiDayInRange: 7 });
    expect(q4.daily.map((p) => p.value)).toEqual([2, 2, 4, 4]);
  });

  it("delta(): 0 for 0→0, null when previous is 0 or a side is missing", () => {
    expect(delta(0, 0)).toEqual({ current: 0, previous: 0, pctChange: 0 });
    expect(delta(5, 0).pctChange).toBeNull();
    expect(delta(null, 5).pctChange).toBeNull();
    expect(delta(150, 100).pctChange).toBe(50);
  });
});
