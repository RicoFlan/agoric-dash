import { parseCoinsAmounts } from "@/lib/cosmos";
import type { TxEventLike } from "@/lib/ibcRecvEventAmounts";

/**
 * Per-denom sum of bank credits to non-module-account receivers within one tx.
 *
 * Source: ONLY `coin_received` events (Cosmos SDK bank emission). `transfer` and `coin_spent`
 * events are deliberately ignored — they describe the same coin movement from different sides
 * and including them would double-count the user-visible credit.
 *
 * Module-account receivers are excluded via the supplied predicate (typically
 * `isAgoricModuleAccount`) so totals reflect value credited to user-owned addresses rather than
 * internal module routing (vbank, IBC escrow, fee collector, gov, etc.).
 *
 * Used by the indexer to populate `SERIES.BANK_CREDITS_VOLUME` on successful txs — see
 * `metricDictionary.ts` and `rollupSourceHierarchy.ts`. For IBC-in amounts the indexer still uses
 * `sumRecvCoinAmountsFromTxEvents`, which has a different, narrower contract (gated to
 * MsgRecvPacket message indices).
 *
 * Event type / attribute keys match Cosmos SDK conventions — verify on major chain upgrades
 * (`protocolCompatibilityNotes.ts`).
 */
export function sumBankCreditsByDenom(
  events: ReadonlyArray<TxEventLike>,
  isModuleAccount: (addr: string) => boolean
): Map<string, bigint> {
  const merged = new Map<string, bigint>();
  for (const ev of events) {
    if (ev.type !== "coin_received") continue;

    let receiver = "";
    const amountValues: string[] = [];
    for (const a of ev.attributes) {
      if (a.key === "receiver") receiver = a.value;
      else if (a.key === "amount") amountValues.push(a.value);
    }
    if (!receiver) continue;
    if (isModuleAccount(receiver)) continue;

    for (const v of amountValues) {
      for (const [denom, amt] of parseCoinsAmounts(v)) {
        merged.set(denom, (merged.get(denom) ?? BigInt(0)) + amt);
      }
    }
  }
  return merged;
}
