import { describe, expect, it } from "vitest";
import { herfindahlFromWeights, topNShare } from "@/lib/concentrationMath";

describe("herfindahlFromWeights", () => {
  it("is 1 for single holder", () => {
    expect(herfindahlFromWeights([100])).toBeCloseTo(1);
  });

  it("is 0.5 for two equal holders", () => {
    expect(herfindahlFromWeights([50, 50])).toBeCloseTo(0.5);
  });

  it("returns null for zero total", () => {
    expect(herfindahlFromWeights([0, 0])).toBeNull();
  });
});

describe("topNShare", () => {
  it("sums top n over total", () => {
    expect(topNShare([50, 30, 20], 2)).toBeCloseTo(0.8);
  });

  it("handles fewer than n entries", () => {
    expect(topNShare([10, 5], 10)).toBeCloseTo(1);
  });
});
