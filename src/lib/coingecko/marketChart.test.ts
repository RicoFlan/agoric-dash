import { describe, expect, it } from "vitest";
import { bucketPricePointsByUtcDay, fetchMarketChartDailyUsd, type MarketChartPoint } from "@/lib/coingecko/marketChart";

const D = (iso: string) => new Date(iso).getTime();

describe("bucketPricePointsByUtcDay", () => {
  it("keeps the earliest point per UTC day regardless of input order or granularity", () => {
    const pts: MarketChartPoint[] = [
      [D("2026-08-01T23:00:00Z"), 1.9],
      [D("2026-08-01T00:00:00Z"), 1.5],
      [D("2026-08-01T12:00:00Z"), 1.7],
      [D("2026-08-02T00:00:00Z"), 2.1],
      [D("2026-08-02T09:31:00Z"), 2.4], // "now" point on a partial day
    ];
    expect(bucketPricePointsByUtcDay(pts)).toEqual([
      { day: "2026-08-01", usd: 1.5 },
      { day: "2026-08-02", usd: 2.1 },
    ]);
  });

  it("skips malformed points and sorts by day", () => {
    const pts = [
      [D("2026-08-03T00:00:00Z"), 3],
      [Number.NaN, 5],
      [D("2026-08-02T00:00:00Z"), -1],
      [D("2026-08-01T00:00:00Z"), 1],
      ["x", 1],
    ] as unknown as MarketChartPoint[];
    expect(bucketPricePointsByUtcDay(pts)).toEqual([
      { day: "2026-08-01", usd: 1 },
      { day: "2026-08-03", usd: 3 },
    ]);
  });
});

describe("fetchMarketChartDailyUsd", () => {
  it("returns bucketed rows on 200 and classifies 404 without throwing", async () => {
    const ok = await fetchMarketChartDailyUsd("agoric", 365, (async () =>
      new Response(JSON.stringify({ prices: [[D("2026-08-01T00:00:00Z"), 0.05]] }), { status: 200 })) as typeof fetch);
    expect(ok.status).toBe("ok");
    expect(ok.rows).toEqual([{ day: "2026-08-01", usd: 0.05 }]);

    const nf = await fetchMarketChartDailyUsd("nope", 30, (async () => new Response("", { status: 404 })) as typeof fetch);
    expect(nf.status).toBe("not_found");
    expect(nf.rows).toEqual([]);
  });

  it("clamps days to the free-tier maximum", async () => {
    let seen = "";
    await fetchMarketChartDailyUsd("agoric", 9999, (async (u: string | URL | Request) => {
      seen = String(u);
      return new Response(JSON.stringify({ prices: [] }), { status: 200 });
    }) as typeof fetch);
    expect(seen).toContain("days=365");
  });
});
