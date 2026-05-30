import { describe, expect, it } from "vitest";
import { blockGasUtilizationPct, gasEfficiencyPct } from "@/lib/gasEfficiency";

describe("gasEfficiencyPct", () => {
  it("computes used/wanted as a percentage", () => {
    expect(gasEfficiencyPct(BigInt(75), BigInt(100))).toBeCloseTo(75);
  });

  it("is 100 when used equals wanted", () => {
    expect(gasEfficiencyPct(BigInt(500), BigInt(500))).toBeCloseTo(100);
  });

  it("returns null when gas_wanted is zero", () => {
    expect(gasEfficiencyPct(BigInt(10), BigInt(0))).toBeNull();
  });

  it("surfaces anomalous over-100 ratios without clamping", () => {
    expect(gasEfficiencyPct(BigInt(120), BigInt(100))).toBeCloseTo(120);
  });

  it("stays precise for large bigint gas sums", () => {
    expect(gasEfficiencyPct(BigInt("900000000000"), BigInt("1000000000000"))).toBeCloseTo(90, 5);
  });
});

describe("blockGasUtilizationPct", () => {
  it("computes used/limit as a percentage", () => {
    // 1 block of 120M limit, 30M used = 25%
    expect(blockGasUtilizationPct(BigInt(30_000_000), BigInt(120_000_000))).toBeCloseTo(25);
  });

  it("aggregates across blocks via summed limit", () => {
    // 10 blocks * 120M = 1.2B limit; 600M used = 50%
    expect(blockGasUtilizationPct(BigInt(600_000_000), BigInt(1_200_000_000))).toBeCloseTo(50);
  });

  it("returns null when no positive block gas limit was recorded", () => {
    expect(blockGasUtilizationPct(BigInt(10), BigInt(0))).toBeNull();
  });
});
