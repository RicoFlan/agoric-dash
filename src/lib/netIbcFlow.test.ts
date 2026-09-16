import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/coingecko/simplePrice", () => ({ getUsdSpotPrices: async () => ({ usdByCoinId: {}, fetchedAtIso: null, partialOrStale: false }) }));

import { DailyPriceTable } from "@/lib/denomPrices";
import { buildNetIbcFlow } from "@/lib/netIbcFlow";
import type { DayBucketMap } from "@/lib/organicActivity";
import type { EnrichedDisplay } from "@/lib/metricsDisplayTypes";
import { SERIES } from "@/lib/semantics";

const display: EnrichedDisplay = {
  metas: { ubld: { displaySymbol: "BLD", decimals: 6 }, uist: { displaySymbol: "IST", decimals: 6 } },
};
const denomToCoinId = new Map([
  ["ubld", "agoric"],
  ["uist", "inter-stable-token"],
]);

const D = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"] as const;

function ctx(rows: Record<string, { in?: Record<string, number>; out?: Record<string, number>; outOrch?: Record<string, number> }>): DayBucketMap {
  const m: DayBucketMap = new Map();
  for (const [day, r] of Object.entries(rows)) {
    const sm = new Map<string, Map<string, bigint>>();
    if (r.in) sm.set(SERIES.IBC_TRANSFER_AMOUNT_IN, new Map(Object.entries(r.in).map(([d, n]) => [d, BigInt(n)])));
    if (r.out) sm.set(SERIES.IBC_TRANSFER_AMOUNT_OUT, new Map(Object.entries(r.out).map(([d, n]) => [d, BigInt(n)])));
    if (r.outOrch) sm.set(SERIES.IBC_TRANSFER_AMOUNT_OUT_ORCH, new Map(Object.entries(r.outOrch).map(([d, n]) => [d, BigInt(n)])));
    m.set(day, sm);
  }
  return m;
}

function table(rows: Record<string, Record<string, number>>) {
  const byId = new Map<string, Map<string, number>>();
  for (const [id, byDay] of Object.entries(rows)) byId.set(id, new Map(Object.entries(byDay)));
  return new DailyPriceTable(byId, D[0], D[3], D[3]);
}

describe("buildNetIbcFlow", () => {
  it("nets in − out per asset, prices each day at its own row, and sums USD across assets only", () => {
    const dailyContext = ctx({
      [D[0]]: { in: { ubld: 10_000_000 } }, // prior window: +10 BLD @ $1
      [D[1]]: { in: { ubld: 20_000_000, uist: 5_000_000 }, out: { ubld: 5_000_000 } }, // +15 BLD @ $2, +5 IST @ $1
      [D[2]]: { out: { ubld: 30_000_000 }, in: { "ibc/UNMAPPED": 7 } }, // −30 BLD @ $1
    });
    const pricer = table({ agoric: { [D[0]]: 1, [D[1]]: 2, [D[2]]: 1 }, "inter-stable-token": { [D[1]]: 1 } }).pricer();
    const r = buildNetIbcFlow({
      dailyContext,
      days: [D[1], D[2]],
      prevDays: [D[0]],
      contextDays: [...D],
      curBuckets: dailyContext,
      display,
      denomToCoinId,
      pricer,
    });

    const bld = r.byAsset.find((a) => a.denom === "ubld")!;
    expect(bld).toMatchObject({ in: "20000000", out: "35000000", net: "-15000000", inUsd: 40, outUsd: 40, netUsd: 0 });
    const ist = r.byAsset.find((a) => a.denom === "uist")!;
    expect(ist).toMatchObject({ net: "5000000", inUsd: 5, outUsd: null, netUsd: 5 });
    const unmapped = r.byAsset.find((a) => a.denom === "ibc/UNMAPPED")!;
    expect(unmapped).toMatchObject({ in: "7", net: "7", netUsd: null });

    // priced assets first by |netUsd| (IST 5, BLD 0), unpriced last
    expect(r.byAsset.map((a) => a.denom)).toEqual(["uist", "ubld", "ibc/UNMAPPED"]);
    expect(r.headline).toMatchObject({ netUsd: 5, previousNetUsd: 10, deltaUsd: -5, inUsd: 45, outUsd: 40, outOrchUsd: null });
    // Coverage: the unmapped asset contributes nothing to netUsd, so the headline must disclose it.
    // usdPricingMeta cannot: its unpricedDays counter only ever sees denoms that HAVE a coin id.
    expect(r.headline.activeAssets).toBe(3);
    expect(r.headline.pricedAssets).toBe(2);
    expect(r.headline.unpricedAssets).toEqual([{ denom: "ibc/UNMAPPED", in: "7", out: "0", net: "7" }]);

    expect(r.dailyNetUsd).toEqual([
      { day: D[0], value: 10 },
      { day: D[1], value: 35 }, // (20−5)×$2 + 5×$1
      { day: D[2], value: -30 }, // unmapped leg contributes nothing but the day still has priced legs
      { day: D[3], value: 0 }, // no legs at all
    ]);
  });

  it("emits chart-grain native series for the top N assets and nulls when nothing is priced", () => {
    const dailyContext = ctx({ [D[1]]: { in: { ubld: 3, uist: 1 }, out: { ubld: 1 } } });
    const weekly: DayBucketMap = new Map([["2026-07-27", dailyContext.get(D[1])!]]);
    const pricer = table({}).pricer(); // no prices at all
    const r = buildNetIbcFlow({
      dailyContext,
      days: [D[1]],
      prevDays: [D[0]],
      contextDays: [D[0], D[1]],
      curBuckets: weekly,
      display,
      denomToCoinId,
      pricer,
      topN: 1,
    });
    expect(r.headline.netUsd).toBeNull();
    expect(r.headline).toMatchObject({ activeAssets: 2, pricedAssets: 0 });
    expect(r.perBucket).toEqual([{ denom: "ubld", data: [{ bucket: "2026-07-27", in: "3", out: "1", net: "2" }] }]);
    expect(r.dailyNetUsd).toEqual([
      { day: D[0], value: 0 },
      { day: D[1], value: null },
    ]);
  });

  it("counts orchestration (EndBlock) sends as outflow and reports them separately", () => {
    const dailyContext = ctx({ [D[1]]: { in: { ubld: 10_000_000 }, out: { ubld: 2_000_000 }, outOrch: { ubld: 5_000_000 } } });
    const pricer = table({ agoric: { [D[1]]: 1 } }).pricer();
    const r = buildNetIbcFlow({ dailyContext, days: [D[1]], prevDays: [D[0]], contextDays: [D[0], D[1]], curBuckets: dailyContext, display, denomToCoinId, pricer });
    expect(r.byAsset[0]).toMatchObject({ denom: "ubld", in: "10000000", out: "7000000", outOrch: "5000000", net: "3000000", netUsd: 3 });
    expect(r.headline).toMatchObject({ netUsd: 3, inUsd: 10, outUsd: 7, outOrchUsd: 5 });
    expect(r.perBucket[0]!.data[0]).toEqual({ bucket: D[1], in: "10000000", out: "7000000", net: "3000000" });
  });
});
