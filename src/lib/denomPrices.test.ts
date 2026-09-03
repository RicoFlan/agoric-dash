import { beforeEach, describe, expect, it, vi } from "vitest";

const getUsdSpotPrices = vi.fn();
vi.mock("@/lib/coingecko/simplePrice", () => ({
  getUsdSpotPrices: (ids: string[]) => getUsdSpotPrices(ids),
}));

import { DailyPriceTable, priceDayDenomAmounts, utcDaysInclusive } from "@/lib/denomPrices";
import type { EnrichedDisplay } from "@/lib/metricsDisplayTypes";

const display: EnrichedDisplay = {
  metas: {
    ubld: { displaySymbol: "BLD", decimals: 6 },
    uist: { displaySymbol: "IST", decimals: 6 },
  },
};

function table(rows: Record<string, Record<string, number>>, from = "2026-08-01", to = "2026-08-03", today = "2026-08-03") {
  const byId = new Map<string, Map<string, number>>();
  for (const [id, byDay] of Object.entries(rows)) byId.set(id, new Map(Object.entries(byDay)));
  return new DailyPriceTable(byId, from, to, today);
}

describe("utcDaysInclusive", () => {
  it("enumerates days and returns empty for inverted ranges", () => {
    expect(utcDaysInclusive("2026-08-30", "2026-09-01")).toEqual(["2026-08-30", "2026-08-31", "2026-09-01"]);
    expect(utcDaysInclusive("2026-09-02", "2026-09-01")).toEqual([]);
  });
});

describe("DailyPriceTable / UsdPricer", () => {
  beforeEach(() => {
    getUsdSpotPrices.mockClear();
  });

  it("prices from rows and reports a daily-close basis without calling spot", async () => {
    const t = table({ agoric: { "2026-08-01": 0.1, "2026-08-02": 0.2, "2026-08-03": 0.3 } });
    await t.ensureSpot(["agoric"]);
    expect(getUsdSpotPrices).not.toHaveBeenCalled();
    const p = t.pricer();
    expect(p.price("agoric", "2026-08-02")).toEqual({ usd: 0.2, basis: "daily-close" });
    expect(p.meta()).toMatchObject({ basis: "daily-close", pricedDays: 1, spotFallbackDays: 0, unpricedDays: 0 });
  });

  it("fetches spot only for ids with a gap and uses it as per-day fallback", async () => {
    getUsdSpotPrices.mockResolvedValue({
      usdByCoinId: { agoric: 0.5 },
      fetchedAtIso: "2026-08-03T12:00:00.000Z",
      partialOrStale: false,
    });
    const t = table({
      agoric: { "2026-08-01": 0.1, "2026-08-02": 0.2 }, // today (08-03) missing
      "inter-stable-token": { "2026-08-01": 1, "2026-08-02": 1, "2026-08-03": 1 },
    });
    await t.ensureSpot(["agoric", "inter-stable-token"]);
    await t.ensureSpot(["agoric"]); // already checked → no second fetch
    expect(getUsdSpotPrices).toHaveBeenCalledTimes(1);
    expect(getUsdSpotPrices).toHaveBeenCalledWith(["agoric"]);
    const p = t.pricer();
    expect(p.price("agoric", "2026-08-01")).toEqual({ usd: 0.1, basis: "daily-close" });
    expect(p.price("agoric", "2026-08-03")).toEqual({ usd: 0.5, basis: "spot-fallback" });
    expect(p.meta()).toMatchObject({ basis: "mixed", pricedDays: 1, spotFallbackDays: 1, spotFetchedAt: "2026-08-03T12:00:00.000Z" });
  });

  it("keeps counters per pricer while sharing prices", () => {
    const t = table({ agoric: { "2026-08-01": 1 } });
    const a = t.pricer();
    const b = t.pricer();
    a.price("agoric", "2026-08-01");
    expect(a.meta().pricedDays).toBe(1);
    expect(b.meta().pricedDays).toBe(0);
  });

  it("does not treat future days as gaps", async () => {
    const t = table({ agoric: { "2026-08-01": 0.1 } }, "2026-08-01", "2026-08-31", "2026-08-01");
    await t.ensureSpot(["agoric"]);
    expect(getUsdSpotPrices).not.toHaveBeenCalled();
  });

  it("counts misses and survives a failing spot fetch", async () => {
    getUsdSpotPrices.mockRejectedValue(new Error("network"));
    const t = table({});
    await t.ensureSpot(["agoric"]);
    const p = t.pricer();
    expect(p.price("agoric", "2026-08-01")).toBeNull();
    expect(p.meta()).toMatchObject({ basis: "none", unpricedDays: 1, partialOrStale: true });
  });
});

describe("priceDayDenomAmounts", () => {
  it("prices each day at its own row and sums per denom", () => {
    const t = table({ agoric: { "2026-08-01": 1, "2026-08-02": 2 }, "inter-stable-token": { "2026-08-01": 1, "2026-08-02": 1 } });
    const byDay = new Map([
      ["2026-08-01", new Map([["ubld", BigInt(10_000_000)], ["uist", BigInt(5_000_000)]])],
      ["2026-08-02", new Map([["ubld", BigInt(10_000_000)]])],
    ]);
    const p = t.pricer();
    const r = priceDayDenomAmounts(byDay, display, p);
    // 10 BLD × $1 + 10 BLD × $2 = $30; 5 IST × $1 = $5
    expect(r.usdByDenom).toEqual({ ubld: 30, uist: 5 });
    expect(r.total).toBe(35);
    expect(p.meta().pricedDays).toBe(3);
  });

  it("nulls unmapped denoms and denoms with no priced day; total null when nothing priced", () => {
    const t = table({});
    const byDay = new Map([["2026-08-01", new Map([["ubld", BigInt(1)], ["ibc/UNKNOWN", BigInt(1)]])]]);
    const p = t.pricer();
    const r = priceDayDenomAmounts(byDay, display, p);
    expect(r.usdByDenom).toEqual({ ubld: null, "ibc/UNKNOWN": null });
    expect(r.total).toBeNull();
    expect(p.meta().unpricedDays).toBe(1); // only the mapped denom counts as a miss
  });
});
