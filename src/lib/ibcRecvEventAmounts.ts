import { parseCoinsAmounts } from "@/lib/cosmos";
import { parseMsgIndexFromAttributes } from "@/lib/txEventMsgIndex";

export type TxEventLike = {
  readonly type: string;
  readonly attributes: ReadonlyArray<{ readonly key: string; readonly value: string }>;
};

function isCoinOrTransfer(ev: TxEventLike): boolean {
  return ev.type === "coin_received" || ev.type === "transfer";
}

function anyCoinTransferHasMsgIndex(events: ReadonlyArray<TxEventLike>): boolean {
  for (const ev of events) {
    if (!isCoinOrTransfer(ev)) continue;
    if (parseMsgIndexFromAttributes(ev.attributes) !== undefined) return true;
  }
  return false;
}

function mergeAmountsInto(
  merged: Map<string, bigint>,
  events: ReadonlyArray<TxEventLike>,
  recvPacketMsgIndices: Set<number> | undefined,
  filterByMsgIndex: boolean
) {
  for (const ev of events) {
    if (!isCoinOrTransfer(ev)) continue;
    if (filterByMsgIndex && recvPacketMsgIndices && recvPacketMsgIndices.size > 0) {
      const mi = parseMsgIndexFromAttributes(ev.attributes);
      if (mi === undefined || !recvPacketMsgIndices.has(mi)) continue;
    }
    for (const a of ev.attributes) {
      if (a.key !== "amount") continue;
      for (const [denom, amt] of parseCoinsAmounts(a.value)) {
        merged.set(denom, (merged.get(denom) ?? BigInt(0)) + amt);
      }
    }
  }
}

export type SumRecvCoinOptions = {
  /**
   * Indices in `TxBody.messages` that are MsgRecvPacket. When tx events include `msg_index` on
   * `coin_received` / `transfer`, only those events are summed; otherwise legacy full-tx sum applies.
   */
  recvPacketMsgIndices?: Set<number>;
};

/**
 * Event type / attribute keys match Cosmos SDK & ibc-go emission conventions — verify on major upgrades
 * (`protocolCompatibilityNotes.ts`).
 *
 * Minimal units credited via bank during tx execution, parsed from `coin_received` and `transfer`
 * events — same sources as `ibc_transfer_amount_in` in the indexer (see rollupSourceHierarchy.ts).
 *
 * When options.recvPacketMsgIndices is set and **any** coin/transfer event exposes `msg_index`,
 * amounts are restricted to MsgRecvPacket message indices so unrelated `coin_received` in the same
 * tx (e.g. bank send) are not attributed to IBC-in. If filtering yields no amounts (emitters omit
 * `msg_index` inconsistently), falls back to the legacy tx-wide sum.
 */
export function sumRecvCoinAmountsFromTxEvents(
  events: ReadonlyArray<TxEventLike>,
  options?: SumRecvCoinOptions
): Map<string, bigint> {
  const recvIdx = options?.recvPacketMsgIndices;
  const shouldTryFilter =
    recvIdx !== undefined && recvIdx.size > 0 && anyCoinTransferHasMsgIndex(events);

  if (!shouldTryFilter) {
    const merged = new Map<string, bigint>();
    mergeAmountsInto(merged, events, recvIdx, false);
    return merged;
  }

  const filtered = new Map<string, bigint>();
  mergeAmountsInto(filtered, events, recvIdx, true);
  if (filtered.size > 0) return filtered;

  const legacy = new Map<string, bigint>();
  mergeAmountsInto(legacy, events, recvIdx, false);
  return legacy;
}

/**
 * Count distinct IBC recv operations from Tendermint events (ibc-go `recv_packet`), using
 * packet_dst_channel + packet_sequence when present. Duplicate attribute sets in one event collapse
 * to one key. Returns 0 when no matching events — caller may fall back to MsgRecvPacket count.
 */
export function countUniqueRecvFlowsFromTxEvents(events: ReadonlyArray<TxEventLike>): number {
  const keys = new Set<string>();
  for (const ev of events) {
    if (!ev.type.toLowerCase().includes("recv_packet")) continue;
    let seq = "";
    let dstCh = "";
    let dstPort = "";
    for (const a of ev.attributes) {
      const k = a.key;
      if (k === "packet_sequence") seq = a.value;
      else if (k === "packet_dst_channel") dstCh = a.value;
      else if (k === "packet_dst_port") dstPort = a.value;
    }
    if (seq) {
      keys.add(`${dstPort}|${dstCh}|${seq}`);
    }
  }
  return keys.size;
}
