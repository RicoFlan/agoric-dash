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

export type SumRecvCoinOptions = {
  /**
   * Indices in `TxBody.messages` that are MsgRecvPacket. When tx events include `msg_index` on
   * `coin_received` / `transfer`, only those events are summed; otherwise legacy full-tx sum applies.
   */
  recvPacketMsgIndices?: Set<number>;
};

function mergeAmountsInto(
  merged: Map<string, bigint>,
  events: ReadonlyArray<TxEventLike>,
  recvPacketMsgIndices: Set<number> | undefined,
  filterByMsgIndex: boolean,
  /** When set, only these event types contribute (subset of coin_received / transfer). */
  onlyTypes?: ReadonlySet<string>
) {
  for (const ev of events) {
    if (onlyTypes) {
      if (!onlyTypes.has(ev.type)) continue;
    } else if (!isCoinOrTransfer(ev)) continue;
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

function mergeAmountsCopy(
  events: ReadonlyArray<TxEventLike>,
  recvPacketMsgIndices: Set<number> | undefined,
  filterByMsgIndex: boolean,
  onlyTypes?: ReadonlySet<string>
): Map<string, bigint> {
  const merged = new Map<string, bigint>();
  mergeAmountsInto(merged, events, recvPacketMsgIndices, filterByMsgIndex, onlyTypes);
  return merged;
}

export type DiagnoseRecvCoinAmountsResult = {
  /** Same result as {@link sumRecvCoinAmountsFromTxEvents}. */
  combined: Map<string, bigint>;
  /** Amounts parsed only from `coin_received` events (same msg_index / legacy rules as combined). */
  fromCoinReceived: Map<string, bigint>;
  /** Amounts parsed only from `transfer` events (same rules). */
  fromTransfer: Map<string, bigint>;
  /** Whether msg_index scoping was applied for the winning branch. */
  usedMsgIndexFilter: boolean;
  /** True only when msg_index filtering was attempted, yielded no amounts, and tx-wide sum was used. */
  usedLegacyFallback: boolean;
};

/**
 * Diagnostic split for investigating whether `coin_received` and `transfer` emissions double-count
 * the same movement for IBC-in-style event sums. Used by `scripts/inspectIbcRecvTxEventAmounts.ts`.
 */
export function diagnoseRecvCoinAmountsByEventType(
  events: ReadonlyArray<TxEventLike>,
  options?: SumRecvCoinOptions
): DiagnoseRecvCoinAmountsResult {
  const recvIdx = options?.recvPacketMsgIndices;
  const shouldTryFilter =
    recvIdx !== undefined && recvIdx.size > 0 && anyCoinTransferHasMsgIndex(events);

  const coinTypes = new Set<string>(["coin_received"]);
  const xferTypes = new Set<string>(["transfer"]);

  if (!shouldTryFilter) {
    const combined = mergeAmountsCopy(events, recvIdx, false);
    return {
      combined,
      fromCoinReceived: mergeAmountsCopy(events, recvIdx, false, coinTypes),
      fromTransfer: mergeAmountsCopy(events, recvIdx, false, xferTypes),
      usedMsgIndexFilter: false,
      usedLegacyFallback: false,
    };
  }

  const filteredCombined = mergeAmountsCopy(events, recvIdx, true);
  if (filteredCombined.size > 0) {
    return {
      combined: filteredCombined,
      fromCoinReceived: mergeAmountsCopy(events, recvIdx, true, coinTypes),
      fromTransfer: mergeAmountsCopy(events, recvIdx, true, xferTypes),
      usedMsgIndexFilter: true,
      usedLegacyFallback: false,
    };
  }

  const legacyCombined = mergeAmountsCopy(events, recvIdx, false);
  return {
    combined: legacyCombined,
    fromCoinReceived: mergeAmountsCopy(events, recvIdx, false, coinTypes),
    fromTransfer: mergeAmountsCopy(events, recvIdx, false, xferTypes),
    usedMsgIndexFilter: false,
    usedLegacyFallback: true,
  };
}

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
    return mergeAmountsCopy(events, recvIdx, false);
  }

  const filtered = mergeAmountsCopy(events, recvIdx, true);
  if (filtered.size > 0) return filtered;

  return mergeAmountsCopy(events, recvIdx, false);
}

/**
 * Single-count ("deduped") IBC-in amount basis. For each denom, returns the **max** of the
 * `coin_received`-only sum and the `transfer`-only sum, rather than their combined (additive) sum.
 *
 * Rationale: for one ICS-20 settlement, ibc-go emits **both** a `coin_received` and a `transfer`
 * event carrying the same amount/msg_index (see `docs/ibcTransferAmountInEventInvestigation.md`), so
 * the additive `sumRecvCoinAmountsFromTxEvents` basis counts each base unit twice. Taking the
 * per-denom max collapses the mirrored legs to a single count and degrades gracefully when only one
 * event family carries a denom. Uses the same msg_index scoping / legacy fallback as the gross basis.
 */
export function sumRecvCoinAmountsDedupedFromTxEvents(
  events: ReadonlyArray<TxEventLike>,
  options?: SumRecvCoinOptions
): Map<string, bigint> {
  const d = diagnoseRecvCoinAmountsByEventType(events, options);
  const out = new Map<string, bigint>();
  const denoms = new Set<string>([...d.fromCoinReceived.keys(), ...d.fromTransfer.keys()]);
  for (const denom of denoms) {
    const cr = d.fromCoinReceived.get(denom) ?? BigInt(0);
    const xf = d.fromTransfer.get(denom) ?? BigInt(0);
    out.set(denom, cr > xf ? cr : xf);
  }
  return out;
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
