import { describe, expect, it } from "vitest";
import { formatSharePct, ymaxContractSplit } from "@/lib/ymaxContractSplit";

const v = (contract: string, positions: number, principalUsd: number | null, principal?: string) => ({
  contract,
  positions,
  principalUsd,
  ...(principal === undefined ? {} : { principal }),
});

describe("ymaxContractSplit", () => {
  it("separates the two concurrent deployments and shows how lopsided they are", () => {
    // Production shape on 2026-09-17: ymax1 ~$15.89M, ymax0 ~$372 — the split exists precisely so a
    // reader can see that the sum is one deployment, and notice if that stops being true.
    const rows = ymaxContractSplit([
      v("ymax1", 322, 15_894_644),
      v("ymax0", 147, 372),
    ]);
    expect(rows.map((r) => r.contract)).toEqual(["ymax1", "ymax0"]);
    expect(rows[0]!.principalUsd).toBe(15_894_644);
    expect(rows[0]!.sharePct).toBeCloseTo(99.9977, 3);
    expect(rows[1]!.sharePct).toBeCloseTo(0.00234, 4);
  });

  it("sums venues within a contract and orders by principal", () => {
    const rows = ymaxContractSplit([v("ymax0", 2, 10), v("ymax1", 3, 40), v("ymax0", 5, 60)]);
    expect(rows[0]).toMatchObject({ contract: "ymax0", positions: 7, principalUsd: 70 });
    expect(rows[1]).toMatchObject({ contract: "ymax1", positions: 3, principalUsd: 40 });
    expect(rows[0]!.sharePct! + rows[1]!.sharePct!).toBeCloseTo(100);
  });

  it("lets one deployment read as the whole when the other is entirely unpriced — which is why the render must qualify the share", () => {
    // The failure the disclosure exists for: ymax0 holds capital, but none of it is priced, so the
    // share arithmetic sees only ymax1. 100% here means "100% of what we could value", not "all of it".
    const rows = ymaxContractSplit([v("ymax1", 10, 500), v("ymax0", 4, null)]);
    const one = rows.find((r) => r.contract === "ymax1")!;
    const zero = rows.find((r) => r.contract === "ymax0")!;
    expect(one.sharePct).toBe(100);
    expect(zero.sharePct).toBeNull();
    // The unpriced count is what makes that qualifiable, so it must survive.
    expect(zero.unpricedVenues).toBe(1);
    expect(rows.reduce((n, r) => n + r.unpricedVenues, 0)).toBe(1);
  });

  it("counts unpriced venues instead of treating them as zero", () => {
    const rows = ymaxContractSplit([v("ymax1", 4, 100), v("ymax1", 2, null), v("ymax0", 1, null)]);
    const one = rows.find((r) => r.contract === "ymax1")!;
    const zero = rows.find((r) => r.contract === "ymax0")!;
    // Positions still count; the unpriced venue is excluded from USD and disclosed.
    expect(one).toMatchObject({ positions: 6, principalUsd: 100, unpricedVenues: 1 });
    // A contract with nothing priced reads null, not 0 — the same distinction as a coverage floor.
    expect(zero).toMatchObject({ positions: 1, principalUsd: null, sharePct: null, unpricedVenues: 1 });
  });

  it("does not sum portfolio counts, which would over-count a portfolio spanning venues", () => {
    // The helper exposes no portfolio total by design; positions are safe to add, portfolios are not.
    const rows = ymaxContractSplit([v("ymax0", 3, 1), v("ymax0", 4, 1)]);
    expect(Object.keys(rows[0]!)).not.toContain("portfolios");
  });

  it("returns an empty split for no venues", () => {
    expect(ymaxContractSplit([])).toEqual([]);
  });
});

  it("drops venues holding nothing, so it agrees with the venue table beside it", () => {
    // Live case: ymaxQueries admits total_in = total_out, so ymax0's Beefy/Optimism venue survives
    // with principal 0. The venue table filters it out; counting its position here made the two
    // disagree on the same page.
    const rows = ymaxContractSplit([
      v("ymax0", 146, 372, "372000000"),
      v("ymax0", 1, 0, "0"),
      v("ymax1", 322, 15_890_015, "15890015000000"),
    ]);
    expect(rows.find((r) => r.contract === "ymax0")!.positions).toBe(146);
    expect(rows.find((r) => r.contract === "ymax1")!.positions).toBe(322);
  });

  it("does not count a drained venue as unpriced", () => {
    // Without the zero check, an unpriced-looking 0 would inflate the unpriced warning.
    const rows = ymaxContractSplit([v("ymax0", 5, 10, "10"), v("ymax0", 1, 0, "0")]);
    expect(rows[0]).toMatchObject({ positions: 5, principalUsd: 10, unpricedVenues: 0 });
  });

  it("falls back to the USD figure when no native principal is supplied", () => {
    const rows = ymaxContractSplit([v("ymax1", 3, 0), v("ymax1", 2, 7)]);
    expect(rows[0]).toMatchObject({ positions: 2, principalUsd: 7 });
  });

describe("formatSharePct", () => {
  it("never prints a dominant share as 100% when something else exists", () => {
    // The production pair. "100.0%" beside "<0.1%" reads as "this is everything" next to "this
    // exists", and the parts appear to exceed the whole.
    expect(formatSharePct(99.9977)).toBe(">99.9%");
    expect(formatSharePct(0.0023)).toBe("<0.1%");
  });

  it("prints exact extremes exactly", () => {
    expect(formatSharePct(100)).toBe("100%");
    expect(formatSharePct(0)).toBe("0%");
  });

  it("rounds ordinary shares to one decimal", () => {
    expect(formatSharePct(62.31)).toBe("62.3%");
    expect(formatSharePct(37.69)).toBe("37.7%");
    expect(formatSharePct(0.14)).toBe("0.1%");
  });

  it("returns null for an unavailable share rather than a misleading 0%", () => {
    expect(formatSharePct(null)).toBeNull();
    expect(formatSharePct(Number.NaN)).toBeNull();
  });
});