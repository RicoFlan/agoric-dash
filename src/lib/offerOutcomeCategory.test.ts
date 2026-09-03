import { describe, expect, it } from "vitest";
import { outcomeCategoryDim, outcomesByCategory, parseOutcomeCategoryDim } from "@/lib/offerOutcomeCategory";

describe("offer_outcome_category dimension", () => {
  it("round-trips category|outcome and rejects unknown parts", () => {
    expect(outcomeCategoryDim("vaults", "wants_satisfied")).toBe("vaults|wants_satisfied");
    expect(parseOutcomeCategoryDim("psm|errored")).toEqual({ category: "psm", outcome: "errored" });
    expect(parseOutcomeCategoryDim("unclassified|wants_unsatisfied")).toEqual({ category: "unclassified", outcome: "wants_unsatisfied" });
    expect(parseOutcomeCategoryDim("vaults")).toBeNull();
    expect(parseOutcomeCategoryDim("bogus|errored")).toBeNull();
    expect(parseOutcomeCategoryDim("vaults|maybe")).toBeNull();
  });

  it("folds totals into per-category rows with satisfaction rate, largest first", () => {
    const rows = outcomesByCategory(
      new Map([
        ["vaults|wants_satisfied", BigInt(6)],
        ["vaults|wants_unsatisfied", BigInt(2)],
        ["vaults|errored", BigInt(2)],
        ["psm|wants_satisfied", BigInt(20)],
        ["garbage", BigInt(99)],
      ])
    );
    expect(rows).toEqual([
      { category: "psm", settled: 20, wantsSatisfied: 20, wantsUnsatisfied: 0, errored: 0, satisfactionRatePct: 100 },
      { category: "vaults", settled: 10, wantsSatisfied: 6, wantsUnsatisfied: 2, errored: 2, satisfactionRatePct: 60 },
    ]);
  });
});
