import { parseCoinsAmounts } from "@/lib/cosmos";

export type TxEventLike = {
  readonly type: string;
  readonly attributes: ReadonlyArray<{ readonly key: string; readonly value: string }>;
};

/**
 * Minimal units credited via bank during tx execution, parsed from `coin_received` and `transfer`
 * events — same sources as `ibc_transfer_amount_in` in the indexer.
 *
 * Must be applied **once per successful tx** when counting IBC recv amounts: scanning these events
 * once per `MsgRecvPacket` message duplicates totals when a tx contains multiple recv packets.
 */
export function sumRecvCoinAmountsFromTxEvents(events: ReadonlyArray<TxEventLike>): Map<string, bigint> {
  const merged = new Map<string, bigint>();
  for (const ev of events) {
    if (ev.type !== "coin_received" && ev.type !== "transfer") continue;
    for (const a of ev.attributes) {
      if (a.key !== "amount") continue;
      for (const [denom, amt] of parseCoinsAmounts(a.value)) {
        merged.set(denom, (merged.get(denom) ?? BigInt(0)) + amt);
      }
    }
  }
  return merged;
}
