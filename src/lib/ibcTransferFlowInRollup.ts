/**
 * Rollup helper for `ibc_transfer_flow_in` only — shared by the indexer and
 * `scripts/backfillIbcTransferFlowIn.ts`.
 * Flow count: recv_packet events first, else decoded MsgRecvPacket count — see SERIES_ROLLUP_SOURCE.
 */
import type { EncodeObject } from "@cosmjs/proto-signing";
import { fromBase64 } from "@cosmjs/encoding";
import { decodeTxRawTx } from "@/lib/cosmos";
import { countUniqueRecvFlowsFromTxEvents } from "@/lib/ibcRecvEventAmounts";
import {
  describeTxResultsLengthMismatch,
  pairedTxCount,
} from "@/lib/blockTxResultsPairing";
import type { RpcBlockResponse, RpcBlockResultsResponse } from "@/lib/rpc";
import { MSG_RECV_PACKET, SERIES, TX_SUCCESS_CODE } from "@/lib/semantics";

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

/** One successful tx: add `ibc_transfer_flow_in` delta when any MsgRecvPacket is present. */
export function addIbcTransferFlowInForTx(
  daily: Map<string, bigint>,
  hourly: Map<string, bigint>,
  day: string,
  hour: Date,
  events: ReadonlyArray<{ type: string; attributes: { key: string; value: string }[] }>,
  recvPacketCount: number
) {
  if (recvPacketCount <= 0) return;
  const uniqRecv = countUniqueRecvFlowsFromTxEvents(events);
  const flowInDelta = uniqRecv > 0 ? BigInt(uniqRecv) : BigInt(recvPacketCount);
  addRollupDelta(daily, hourly, day, hour, SERIES.IBC_TRANSFER_FLOW_IN, "", flowInDelta);
}

/**
 * Scan one block’s successful txs and accumulate only `SERIES.IBC_TRANSFER_FLOW_IN` into `daily` / `hourly`.
 */
export function accumulateIbcTransferFlowInFromBlock(
  block: RpcBlockResponse,
  results: RpcBlockResultsResponse,
  daily: Map<string, bigint>,
  hourly: Map<string, bigint>
) {
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
    console.warn(`[accumulateIbcTransferFlowInFromBlock] height ${block.block.header.height}: ${mismatchDetail}`);
  }
  const n = pairedTxCount(blockTxCount, resultsCount);

  for (let i = 0; i < n; i++) {
    const tr = txResults[i]!;
    if (tr.code !== TX_SUCCESS_CODE) continue;
    let decoded;
    try {
      decoded = decodeTxRawTx(fromBase64(txsB64[i]!));
    } catch {
      continue;
    }
    let recvPacketCount = 0;
    for (const msg of decoded.body.messages) {
      if ((msg as EncodeObject).typeUrl === MSG_RECV_PACKET) recvPacketCount += 1;
    }
    addIbcTransferFlowInForTx(daily, hourly, day, hour, eventsPerTx[i] ?? [], recvPacketCount);
  }
}
