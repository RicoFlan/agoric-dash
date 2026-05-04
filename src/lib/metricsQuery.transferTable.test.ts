import { describe, expect, it } from "vitest";
import { transferVolumeTableByDenom } from "@/lib/metricsQuery";
import { SERIES } from "@/lib/semantics";

function makeBucketMap(
  bySeries: Record<string, Record<string, bigint>>
): Map<string, Map<string, Map<string, bigint>>> {
  const perBucket = new Map<string, Map<string, bigint>>();
  for (const [series, dims] of Object.entries(bySeries)) {
    const dm = new Map<string, bigint>();
    for (const [denom, v] of Object.entries(dims)) dm.set(denom, v);
    perBucket.set(series, dm);
  }
  return new Map([["2025-01-01T00:00:00.000Z", perBucket]]);
}

describe("transferVolumeTableByDenom", () => {
  it("includes IBC receive–only denoms in the table totals", () => {
    const m = makeBucketMap({
      [SERIES.TRANSFER_VOLUME]: { ubld: BigInt(100) },
      [SERIES.IBC_TRANSFER_AMOUNT_IN]: { "ibc/RECV_ONLY": BigInt(50) },
    });
    expect(transferVolumeTableByDenom(m)).toEqual({
      ubld: "100",
      "ibc/RECV_ONLY": "50",
    });
  });

  it("adds transfer_volume and ibc_transfer_amount_in for the same denom (no IBC out double-count)", () => {
    const m = makeBucketMap({
      [SERIES.TRANSFER_VOLUME]: { uatom: BigInt(10) },
      [SERIES.IBC_TRANSFER_AMOUNT_IN]: { uatom: BigInt(5) },
    });
    expect(transferVolumeTableByDenom(m)).toEqual({ uatom: "15" });
  });
});
