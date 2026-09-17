import { describe, expect, it } from "vitest";
import { buildOfferEngagement, buildOffersSection, type OfferBuckets } from "@/lib/offersMetrics";
import { SERIES } from "@/lib/semantics";

/** Build a bucket map from a compact [bucket, series, dimension, value] list. */
function buckets(rows: Array<[string, string, string, number]>): OfferBuckets {
  const b: OfferBuckets = new Map();
  for (const [bucket, series, dim, val] of rows) {
    if (!b.has(bucket)) b.set(bucket, new Map());
    const sm = b.get(bucket)!;
    if (!sm.has(series)) sm.set(series, new Map());
    sm.get(series)!.set(dim, BigInt(val));
  }
  return b;
}

describe("buildOffersSection", () => {
  const cur = buckets([
    ["2026-05-29", SERIES.WALLET_ACTIONS, "zoe_offer", 5],
    ["2026-05-29", SERIES.WALLET_ACTIONS, "wallet_invocation", 9],
    ["2026-05-29", SERIES.OFFER_CATEGORY, "psm", 1],
    ["2026-05-29", SERIES.OFFER_CATEGORY, "fast_usdc", 4],
    ["2026-05-29", SERIES.OFFER_CATEGORY, "orchestration", 9],
    ["2026-05-29", SERIES.OFFER_SOURCE, "contract", 1],
    ["2026-05-29", SERIES.OFFER_SOURCE, "continuing", 4],
    ["2026-05-29", SERIES.OFFER_INSTANCE, "board02568", 1],
    ["2026-05-29", SERIES.OFFER_MAKER, "SettleTransaction", 4],
    ["2026-05-29", SERIES.OFFER_MAKER, "makeGiveMintedInvitation", 1],
    ["2026-05-29", SERIES.INVOKE_TARGET, "planner", 7],
    ["2026-05-29", SERIES.INVOKE_TARGET, "evmWalletHandler", 2],
    ["2026-05-29", SERIES.OFFER_OUTCOME, "wants_satisfied", 3],
    ["2026-05-29", SERIES.OFFER_OUTCOME, "errored", 1],
    ["2026-05-30", SERIES.WALLET_ACTIONS, "zoe_offer", 1],
    ["2026-05-30", SERIES.OFFER_CATEGORY, "psm", 1],
    ["2026-05-30", SERIES.OFFER_OUTCOME, "wants_satisfied", 1],
  ]);
  const prev = buckets([["2026-05-28", SERIES.WALLET_ACTIONS, "zoe_offer", 2]]);
  const s = buildOffersSection(cur, prev);

  it("computes KPIs with automated vs interactive split", () => {
    expect(s.kpis.totalActions.current).toBe("15"); // 5+9 + 1
    expect(s.kpis.zoeOffers.current).toBe("6");
    expect(s.kpis.walletInvocations.current).toBe("9");
    // automated = orchestration(9) + fast_usdc(4); interactive = psm(1+1=2)
    expect(s.kpis.automatedActions.current).toBe("13");
    expect(s.kpis.interactiveActions.current).toBe("2");
    expect(s.kpis.zoeOffers.previous).toBe("2");
  });

  it("ranks categories and resolves instance names", () => {
    expect(s.byCategory.map((c) => c.category)).toEqual(["orchestration", "fast_usdc", "psm"]);
    expect(s.byCategory.find((c) => c.category === "psm")?.count).toBe("2");
    expect(s.byInstance[0]).toEqual({ key: "board02568", label: "psm-IST-USDC_grv", count: "1" });
    expect(s.byTarget[0]).toEqual({ key: "planner", label: "planner", count: "7" });
  });

  it("summarizes settled offer outcomes and satisfaction rate", () => {
    expect(s.outcomes.settled.current).toBe("5"); // 3+1 + 1
    expect(s.outcomes.wantsSatisfied.current).toBe("4");
    expect(s.outcomes.errored.current).toBe("1");
    expect(s.outcomes.wantsUnsatisfied.current).toBe("0");
    expect(s.outcomes.satisfactionRatePct).toBe(80); // 4/5
    const sat = s.outcomes.overTime.find((o) => o.outcome === "wants_satisfied")!;
    expect(sat.data.map((p) => p.value)).toEqual(["3", "1"]);
    // no unsatisfied present → omitted from overTime
    expect(s.outcomes.overTime.some((o) => o.outcome === "wants_unsatisfied")).toBe(false);
  });

  it("returns null satisfaction rate when nothing settled", () => {
    const empty = buildOffersSection(new Map(), new Map());
    expect(empty.outcomes.satisfactionRatePct).toBeNull();
    expect(empty.outcomes.settled.current).toBe("0");
  });

  it("produces dense per-category trend points sorted by bucket", () => {
    const psm = s.categoriesOverTime.find((c) => c.category === "psm")!;
    expect(psm.data.map((p) => [p.bucket, p.value])).toEqual([
      ["2026-05-29", "1"],
      ["2026-05-30", "1"],
    ]);
    expect(s.totalOverTime.map((p) => p.value)).toEqual(["14", "1"]);
  });

  it("reports offers seen and the unresolved residue as a partition of it", () => {
    // seen = zoe_offer 5+1 = 6; settled = 3+1 + 1 = 5 → 1 unresolved
    expect(s.outcomes.offersSeen.current).toBe("6");
    expect(s.outcomes.settled.current).toBe("5");
    expect(s.outcomes.unresolved.current).toBe("1");
    const o = s.outcomes;
    expect(BigInt(o.settled.current) + BigInt(o.unresolved.current)).toBe(BigInt(o.offersSeen.current));
  });

  it("lets the unresolved residue go negative when an earlier offer settles inside the window", () => {
    // Prior window saw 2 offers and settled none of them; they settle in the current window.
    const seenLate = buckets([
      ["2026-05-29", SERIES.WALLET_ACTIONS, "zoe_offer", 1],
      ["2026-05-29", SERIES.OFFER_OUTCOME, "wants_satisfied", 3],
    ]);
    const o = buildOffersSection(seenLate, new Map()).outcomes;
    expect(o.offersSeen.current).toBe("1");
    expect(o.settled.current).toBe("3");
    expect(o.unresolved.current).toBe("-2"); // surfaced, not clamped
  });

  it("splits offer_source into continuing vs fresh, excluding unknown from the share", () => {
    // cur: continuing 4, contract 1 → 4/5
    expect(s.engagement).toEqual({ continuing: "4", fresh: "1", unknown: "0", continuingSharePct: 80 });
  });
});

describe("buildOfferEngagement", () => {
  const dims = (m: Record<string, number>) => new Map(Object.entries(m).map(([k, v]) => [k, BigInt(v)]));

  it("treats every non-continuing, non-unknown source as fresh", () => {
    expect(buildOfferEngagement(dims({ continuing: 2573, contract: 41, purse: 40, agoricContract: 9 }))).toEqual({
      continuing: "2573",
      fresh: "90",
      unknown: "0",
      continuingSharePct: 96.62,
    });
  });

  it("keeps unknown-source offers out of both sides of the share", () => {
    const e = buildOfferEngagement(dims({ continuing: 3, contract: 1, unknown: 96 }));
    expect(e).toEqual({ continuing: "3", fresh: "1", unknown: "96", continuingSharePct: 75 });
  });

  it("returns a null share when no source-bearing offers were seen", () => {
    expect(buildOfferEngagement(dims({})).continuingSharePct).toBeNull();
    expect(buildOfferEngagement(dims({ unknown: 4 })).continuingSharePct).toBeNull();
  });
});
