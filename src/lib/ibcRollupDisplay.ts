import { SERIES } from "@/lib/semantics";

type SeriesDimensionMap = Map<string, Map<string, bigint>>;

/**
 * Inbound IBC headline count for one time bucket: `ibc_transfer_flow_in` when present (post-indexer
 * upgrade), else legacy `ibc_transfer_in_count` (MsgRecvPacket message count).
 */
export function ibcRecvFlowForBucket(seriesMap: SeriesDimensionMap): bigint {
  const flow = seriesMap.get(SERIES.IBC_TRANSFER_FLOW_IN);
  if (flow !== undefined) {
    return flow.get("") ?? BigInt(0);
  }
  return seriesMap.get(SERIES.IBC_TRANSFER_IN_COUNT)?.get("") ?? BigInt(0);
}

export function sumIbcRecvDisplay(
  bucketMap: Map<string, Map<string, Map<string, bigint>>>
): bigint {
  let t = BigInt(0);
  for (const sm of bucketMap.values()) {
    t += ibcRecvFlowForBucket(sm);
  }
  return t;
}

export function seriesIbcRecvDisplayOverTime(
  bucketMap: Map<string, Map<string, Map<string, bigint>>>
): { bucket: string; value: string }[] {
  const keys = [...bucketMap.keys()].sort();
  return keys.map((bucket) => ({
    bucket,
    value: ibcRecvFlowForBucket(bucketMap.get(bucket)!).toString(),
  }));
}

export function seriesIbcMsgCombinedOverTime(
  bucketMap: Map<string, Map<string, Map<string, bigint>>>
): { bucket: string; value: string }[] {
  const keys = [...bucketMap.keys()].sort();
  return keys.map((bucket) => {
    const sm = bucketMap.get(bucket)!;
    const out = sm.get(SERIES.IBC_TRANSFER_OUT_COUNT)?.get("") ?? BigInt(0);
    const recv = ibcRecvFlowForBucket(sm);
    return { bucket, value: (out + recv).toString() };
  });
}
