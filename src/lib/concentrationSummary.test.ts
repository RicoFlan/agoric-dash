import { describe, expect, it } from "vitest";
import {
  buildConcentrationSummary,
  formatHhi,
  formatSharePct,
} from "@/lib/concentrationSummary";

describe("buildConcentrationSummary", () => {
  it("computes top-N share regardless of input order", () => {
    const s = buildConcentrationSummary([20, 50, 30], [], 2);
    // top 2 of {50,30,20} = 80 of 100
    expect(s.topNShareGrossUsd).toBeCloseTo(0.8);
  });

  it("computes HHI for both dimensions", () => {
    // two equal holders -> HHI 0.5; single holder -> HHI 1
    const s = buildConcentrationSummary([50, 50], [100], 10);
    expect(s.grossUsdHhi).toBeCloseTo(0.5);
    expect(s.feesUsdHhi).toBeCloseTo(1);
  });

  it("returns null for empty / unpriced dimensions", () => {
    const s = buildConcentrationSummary([], [], 10);
    expect(s.topNShareGrossUsd).toBeNull();
    expect(s.topNShareFeesUsd).toBeNull();
    expect(s.grossUsdHhi).toBeNull();
    expect(s.feesUsdHhi).toBeNull();
  });

  it("treats fee totals independently of gross totals", () => {
    const s = buildConcentrationSummary([10, 10, 10, 10], [90, 10], 1);
    // gross top-1 of 40 = 0.25; fees top-1 of 100 = 0.9
    expect(s.topNShareGrossUsd).toBeCloseTo(0.25);
    expect(s.topNShareFeesUsd).toBeCloseTo(0.9);
  });
});

describe("formatSharePct", () => {
  it("formats a share as a percentage", () => {
    expect(formatSharePct(0.802)).toBe("80.2%");
  });
  it("renders an em dash for null", () => {
    expect(formatSharePct(null)).toBe("—");
  });
});

describe("formatHhi", () => {
  it("formats to three decimals", () => {
    expect(formatHhi(0.05)).toBe("0.050");
  });
  it("renders an em dash for null", () => {
    expect(formatHhi(null)).toBe("—");
  });
});
