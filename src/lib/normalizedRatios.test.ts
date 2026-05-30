import { describe, expect, it } from "vitest";
import {
  computeNormalizedRatios,
  formatNormalizedRatios,
} from "@/lib/normalizedRatios";

const base = {
  gasUsed: BigInt(0),
  successfulTxs: BigInt(0),
  failedTxs: BigInt(0),
  feeUbld: BigInt(0),
  feeDenomDecimals: 6,
  activeAddresses: 0,
  grossUsdTotal: null as number | null,
};

describe("computeNormalizedRatios", () => {
  it("divides gas over all included txs (success + failed)", () => {
    const r = computeNormalizedRatios({
      ...base,
      gasUsed: BigInt(1000),
      successfulTxs: BigInt(6),
      failedTxs: BigInt(4),
    });
    expect(r.gasPerTx).toBeCloseTo(100); // 1000 / (6+4)
  });

  it("computes BLD fee per successful tx from ubld minimal units", () => {
    const r = computeNormalizedRatios({
      ...base,
      feeUbld: BigInt(3_000_000), // 3 BLD
      successfulTxs: BigInt(2),
    });
    expect(r.feeBldPerSuccessfulTx).toBeCloseTo(1.5);
  });

  it("computes per-active-address ratios", () => {
    const r = computeNormalizedRatios({
      ...base,
      successfulTxs: BigInt(100),
      failedTxs: BigInt(0),
      activeAddresses: 25,
      grossUsdTotal: 5000,
    });
    expect(r.successfulTxsPerActiveAddress).toBeCloseTo(4);
    expect(r.grossUsdPerActiveAddress).toBeCloseTo(200);
  });

  it("returns null when denominators are zero or USD unpriced", () => {
    const r = computeNormalizedRatios(base);
    expect(r.gasPerTx).toBeNull();
    expect(r.feeBldPerSuccessfulTx).toBeNull();
    expect(r.successfulTxsPerActiveAddress).toBeNull();
    expect(r.grossUsdPerActiveAddress).toBeNull();
  });

  it("nulls gross USD per address when total is null even if addresses exist", () => {
    const r = computeNormalizedRatios({ ...base, activeAddresses: 10, grossUsdTotal: null });
    expect(r.grossUsdPerActiveAddress).toBeNull();
  });
});

describe("formatNormalizedRatios", () => {
  it("formats ratios with units and dashes for nulls", () => {
    const s = formatNormalizedRatios({
      gasPerTx: 123456.7,
      feeBldPerSuccessfulTx: 0.0125,
      successfulTxsPerActiveAddress: 4.0,
      grossUsdPerActiveAddress: 200,
    });
    expect(s.gasPerTx).toBe("123,457");
    expect(s.feeBldPerSuccessfulTx).toBe("0.0125 BLD");
    expect(s.successfulTxsPerActiveAddress).toBe("4");
    expect(s.grossUsdPerActiveAddress).toBe("$200.00");
  });

  it("renders dashes when values are null", () => {
    const s = formatNormalizedRatios({
      gasPerTx: null,
      feeBldPerSuccessfulTx: null,
      successfulTxsPerActiveAddress: null,
      grossUsdPerActiveAddress: null,
    });
    expect(s).toEqual({
      gasPerTx: "—",
      feeBldPerSuccessfulTx: "—",
      successfulTxsPerActiveAddress: "—",
      grossUsdPerActiveAddress: "—",
    });
  });
});
