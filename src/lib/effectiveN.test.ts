import { describe, expect, it } from "vitest";
import { effectiveNumberFromHhi, herfindahlFromWeights } from "@/lib/concentrationMath";

describe("effectiveNumberFromHhi", () => {
  it("is the number of equal participants that would produce the same HHI", () => {
    expect(effectiveNumberFromHhi(herfindahlFromWeights([1, 1, 1, 1]))).toBeCloseTo(4, 9);
    expect(effectiveNumberFromHhi(1)).toBe(1);
    // one dominant address: HHI 0.82 → ~1.2 effective
    expect(effectiveNumberFromHhi(herfindahlFromWeights([90, 5, 5]))).toBeCloseTo(1 / 0.815, 6);
  });

  it("is null for null, zero, or non-finite HHI", () => {
    expect(effectiveNumberFromHhi(null)).toBeNull();
    expect(effectiveNumberFromHhi(0)).toBeNull();
    expect(effectiveNumberFromHhi(Number.NaN)).toBeNull();
  });
});
