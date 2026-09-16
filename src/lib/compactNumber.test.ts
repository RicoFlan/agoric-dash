import { describe, expect, it } from "vitest";
import { fmtCompactInt, fmtCompactUsd } from "@/lib/compactNumber";

describe("fmtCompactInt", () => {
  it("leaves small numbers exact and offers no tooltip", () => {
    expect(fmtCompactInt(842)).toEqual({ text: "842", exact: null });
    expect(fmtCompactInt(9999)).toEqual({ text: "9,999", exact: null });
  });

  it("abbreviates at and above the threshold, keeping the exact value", () => {
    expect(fmtCompactInt(10_000)).toEqual({ text: "10K", exact: "10,000" });
    expect(fmtCompactInt(1_234_567)).toEqual({ text: "1.2M", exact: "1,234,567" });
  });

  it("handles negatives and non-numbers", () => {
    expect(fmtCompactInt(-1_500_000).text).toBe("-1.5M");
    expect(fmtCompactInt(null)).toEqual({ text: "—", exact: null });
    expect(fmtCompactInt(Number.NaN)).toEqual({ text: "—", exact: null });
  });
});

describe("fmtCompactUsd", () => {
  it("keeps cents below the threshold", () => {
    expect(fmtCompactUsd(1234.5)).toEqual({ text: "$1,234.50", exact: null });
  });

  it("abbreviates large amounts and keeps the exact amount for the tooltip", () => {
    expect(fmtCompactUsd(15_850_000)).toEqual({ text: "$15.9M", exact: "$15,850,000.00" });
  });

  it("uses a true minus for negatives and an explicit plus only when asked", () => {
    expect(fmtCompactUsd(-2_500_000).text).toBe("−$2.5M");
    expect(fmtCompactUsd(2_500_000, true).text).toBe("+$2.5M");
    expect(fmtCompactUsd(2_500_000).text).toBe("$2.5M");
  });
});
