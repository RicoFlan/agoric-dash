import { describe, expect, it } from "vitest";
import { SERIES } from "@/lib/semantics";
import { ibcRecvFlowForBucket } from "./ibcRollupDisplay";

function bucket(flowIn?: string, rawIn?: string): Map<string, Map<string, bigint>> {
  const sm = new Map<string, Map<string, bigint>>();
  if (flowIn !== undefined) {
    sm.set(SERIES.IBC_TRANSFER_FLOW_IN, new Map([["", BigInt(flowIn)]]));
  }
  if (rawIn !== undefined) {
    sm.set(SERIES.IBC_TRANSFER_IN_COUNT, new Map([["", BigInt(rawIn)]]));
  }
  return sm;
}

describe("ibcRecvFlowForBucket", () => {
  it("prefers ibc_transfer_flow_in when series exists", () => {
    expect(ibcRecvFlowForBucket(bucket("3", "99"))).toBe(BigInt(3));
  });

  it("falls back to ibc_transfer_in_count when flow_in absent", () => {
    expect(ibcRecvFlowForBucket(bucket(undefined, "12"))).toBe(BigInt(12));
  });

  it("uses zero when flow_in present but empty dimension", () => {
    const sm = new Map<string, Map<string, bigint>>();
    sm.set(SERIES.IBC_TRANSFER_FLOW_IN, new Map());
    expect(ibcRecvFlowForBucket(sm)).toBe(BigInt(0));
  });
});
