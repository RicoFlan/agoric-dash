import { describe, expect, it } from "vitest";
import { buildOrganicActivity, organicRatioPct, unclassifiedSharePct, type DayBucketMap } from "@/lib/organicActivity";
import { SERIES } from "@/lib/semantics";

function ctx(rows: Record<string, Record<string, number>>): DayBucketMap {
  const m: DayBucketMap = new Map();
  for (const [day, cats] of Object.entries(rows)) {
    m.set(day, new Map([[SERIES.OFFER_CATEGORY, new Map(Object.entries(cats).map(([c, n]) => [c, BigInt(n)]))]]));
  }
  return m;
}

describe("buildOrganicActivity", () => {
  it("groups categories by automation class and computes interactive ÷ all", () => {
    const d = ctx({
      "2026-08-01": { vaults: 3, psm: 1, oracle: 12, other: 4 }, // prior window
      "2026-08-02": { vaults: 2, auction: 2, orchestration: 6 }, // range
      "2026-08-03": { governance: 1, fast_usdc: 9 }, // range
    });
    const r = buildOrganicActivity(d, ["2026-08-02", "2026-08-03"], ["2026-08-01"], ["2026-08-01", "2026-08-02", "2026-08-03"]);
    expect(r.counts.current).toMatchObject({ interactive: 5, automated: 15, other: 0, total: 20 });
    expect(r.counts.previous).toMatchObject({ interactive: 4, automated: 12, other: 4, total: 20 });
    // Which products the interactive actions came from, so one product cannot masquerade as breadth.
    expect(r.counts.current.interactiveByCategory).toEqual([
      { category: "vaults", count: 2 },
      { category: "auction", count: 2 },
      { category: "governance", count: 1 },
    ]);
    expect(r.ratioPct.current).toBe(25);
    expect(r.ratioPct.previous).toBe(20);
    expect(r.ratioPct.deltaPts).toBe(5);
    expect(r.dailyRatioPct).toEqual([
      { day: "2026-08-01", value: 20 },
      { day: "2026-08-02", value: 40 },
      { day: "2026-08-03", value: 10 },
    ]);
  });

  it("yields null ratios for windows and days with no actions", () => {
    const r = buildOrganicActivity(ctx({}), ["2026-08-02"], ["2026-08-01"], ["2026-08-01", "2026-08-02"]);
    expect(r.ratioPct).toEqual({ current: null, previous: null, deltaPts: null });
    expect(r.dailyRatioPct.every((p) => p.value === null)).toBe(true);
    expect(organicRatioPct({ interactive: 0, automated: 0, other: 0, total: 0, interactiveByCategory: [] })).toBeNull();
  });

  it("reports the unclassified share that suppresses the ratio, and null when nothing was categorized", () => {
    const counts = { interactive: 2, automated: 6, other: 2, total: 10, interactiveByCategory: [] };
    expect(unclassifiedSharePct(counts)).toBe(20);
    // The organic ratio and the unclassified share bound the true user-initiated share.
    expect(organicRatioPct(counts)).toBe(20);
    expect(unclassifiedSharePct({ interactive: 0, automated: 0, other: 0, total: 0, interactiveByCategory: [] })).toBeNull();
  });
});
