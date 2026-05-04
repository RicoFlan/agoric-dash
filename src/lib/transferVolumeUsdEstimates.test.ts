import { describe, expect, it } from "vitest";
import { formatUsdEstimate } from "./transferVolumeUsdEstimates";

describe("formatUsdEstimate", () => {
  it("returns em dash for non-finite or negative values", () => {
    expect(formatUsdEstimate(Number.NaN)).toBe("—");
    expect(formatUsdEstimate(-1)).toBe("—");
  });

  it("formats zero", () => {
    expect(formatUsdEstimate(0)).toMatch(/^\$0\.00$/);
  });

  it("formats typical line amounts with currency style", () => {
    const s = formatUsdEstimate(1234.567);
    expect(s.startsWith("$")).toBe(true);
    expect(s).toMatch(/1,234\.57/);
  });

  it("uses fewer fraction digits for very large values", () => {
    const s = formatUsdEstimate(2_500_000_000);
    expect(s).toMatch(/\$2,500,000,000/);
  });
});
