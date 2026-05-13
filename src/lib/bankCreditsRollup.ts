/**
 * Rollup helper for `bank_credits_volume` only — shared by the indexer and
 * `scripts/backfillBankCreditsVolume.ts`.
 *
 * Source: `coin_received` events (Cosmos SDK bank emission), per-denom sum of amounts whose
 * `receiver` is not in the supplied module-account predicate — see
 * `bankCreditsFromTxEvents.ts` and `rollupSourceHierarchy.ts`.
 *
 * The body of each tx is **not** decoded here; this metric is event-only. Successful txs only
 * (ABCI code 0) — matches `metricDictionary.ts` successScope.
 */
import { sumBankCreditsByDenom } from "@/lib/bankCreditsFromTxEvents";
import type { TxEventLike } from "@/lib/ibcRecvEventAmounts";
import {
  describeTxResultsLengthMismatch,
  pairedTxCount,
} from "@/lib/blockTxResultsPairing";
import type { RpcBlockResponse, RpcBlockResultsResponse } from "@/lib/rpc";
import { SERIES, TX_SUCCESS_CODE } from "@/lib/semantics";

const ROLLUP_KEY_DELIM = "\0";

function bumpRollupMap(m: Map<string, bigint>, key: string, delta: bigint) {
  if (delta === BigInt(0)) return;
  m.set(key, (m.get(key) ?? BigInt(0)) + delta);
}

function addRollupDelta(
  daily: Map<string, bigint>,
  hourly: Map<string, bigint>,
  day: string,
  hour: Date,
  series: string,
  dimension: string,
  delta: bigint
) {
  if (delta === BigInt(0)) return;
  bumpRollupMap(daily, [day, series, dimension].join(ROLLUP_KEY_DELIM), delta);
  bumpRollupMap(hourly, [hour.toISOString(), series, dimension].join(ROLLUP_KEY_DELIM), delta);
}

export function dayUtc(isoTime: string): string {
  const d = new Date(isoTime);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function hourStartUtcFromIso(isoTime: string): Date {
  const d = new Date(isoTime);
  d.setUTCMilliseconds(0);
  d.setUTCSeconds(0);
  d.setUTCMinutes(0);
  return d;
}

function asEventKV(
  txs: RpcBlockResultsResponse["txs_results"]
): Array<Array<{ type: string; attributes: { key: string; value: string }[] }>> {
  if (!txs) return [];
  return txs.map((tx) =>
    (tx.events ?? []).map((e) => ({
      type: e.type,
      attributes: (e.attributes ?? []).map((a) => ({ key: a.key, value: a.value })),
    }))
  );
}

/** One successful tx: add `bank_credits_volume` deltas per non-module-account `coin_received`. */
export function addBankCreditsForTx(
  daily: Map<string, bigint>,
  hourly: Map<string, bigint>,
  day: string,
  hour: Date,
  events: ReadonlyArray<TxEventLike>,
  isModuleAccount: (addr: string) => boolean
): void {
  for (const [denom, amt] of sumBankCreditsByDenom(events, isModuleAccount)) {
    addRollupDelta(daily, hourly, day, hour, SERIES.BANK_CREDITS_VOLUME, denom, amt);
  }
}

/**
 * Scan one block’s successful txs and accumulate only `SERIES.BANK_CREDITS_VOLUME` into
 * `daily` / `hourly`. Tx body is never decoded — events carry everything this metric needs.
 */
export function accumulateBankCreditsFromBlock(
  block: RpcBlockResponse,
  results: RpcBlockResultsResponse,
  daily: Map<string, bigint>,
  hourly: Map<string, bigint>,
  isModuleAccount: (addr: string) => boolean
): void {
  const iso = block.block.header.time;
  const day = dayUtc(iso);
  const hour = hourStartUtcFromIso(iso);
  const txsB64 = block.block.data?.txs ?? [];
  const txResults = results.txs_results ?? [];
  const eventsPerTx = asEventKV(txResults);
  const blockTxCount = txsB64.length;
  const resultsCount = txResults.length;
  const mismatchDetail = describeTxResultsLengthMismatch(blockTxCount, resultsCount);
  if (mismatchDetail) {
    console.warn(
      `[accumulateBankCreditsFromBlock] height ${block.block.header.height}: ${mismatchDetail}`
    );
  }
  const n = pairedTxCount(blockTxCount, resultsCount);

  for (let i = 0; i < n; i++) {
    const tr = txResults[i]!;
    if (tr.code !== TX_SUCCESS_CODE) continue;
    addBankCreditsForTx(daily, hourly, day, hour, eventsPerTx[i] ?? [], isModuleAccount);
  }
}
