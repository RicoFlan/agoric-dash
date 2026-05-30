import { describe, expect, it } from "vitest";
import { formatRatePct, successRatePct } from "@/lib/txSuccessRate";

describe("successRatePct", () => {
  it("is 100 when there are no failures", () => {
    expect(successRatePct(BigInt(10), BigInt(0))).toBeCloseTo(100);
  });

  it("is 0 when every tx failed", () => {
    expect(successRatePct(BigInt(0), BigInt(7))).toBeCloseTo(0);
  });

  it("computes a partial rate", () => {
    expect(successRatePct(BigInt(3), BigInt(1))).toBeCloseTo(75);
  });

  it("returns null when there are no aligned txs", () => {
    expect(successRatePct(BigInt(0), BigInt(0))).toBeNull();
  });

  it("stays precise for large bigint counts", () => {
    expect(successRatePct(BigInt("999999999999"), BigInt("1"))).toBeCloseTo(100, 5);
  });
});

describe("formatRatePct", () => {
  it("formats to two decimals with a percent sign", () => {
    expect(formatRatePct(99.219)).toBe("99.22%");
  });

  it("renders an em dash for null", () => {
    expect(formatRatePct(null)).toBe("—");
  });

  it("renders an em dash for non-finite input", () => {
    expect(formatRatePct(Number.NaN)).toBe("—");
  });
});
