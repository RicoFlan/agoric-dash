/**
 * Inspect `coin_received` vs `transfer` event amounts for one successful tx that includes
 * MsgRecvPacket — same parsing rules as `sumRecvCoinAmountsFromTxEvents` / `ibc_transfer_amount_in`.
 *
 * Use to verify whether both event types describe the same bank movement (double-count risk when
 * summed) on live agoric-3 data. See docs/ibcTransferAmountInEventInvestigation.md.
 *
 * Usage:
 *   npx tsx scripts/inspectIbcRecvTxEventAmounts.ts --height=25150000 --tx-index=0
 *   npx tsx scripts/inspectIbcRecvTxEventAmounts.ts --find-first-recv=25150000
 *   npx tsx scripts/inspectIbcRecvTxEventAmounts.ts --find-first-recv=25150000 --rpc=https://main-a.rpc.agoric.net
 *
 * Env: RPC_URL, optional RPC_URL_FALLBACK (per-call failover). `--rpc=URL` disables fallback.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { fromBase64 } from "@cosmjs/encoding";
import type { EncodeObject } from "@cosmjs/proto-signing";
import { decodeTxRawTx } from "../src/lib/cosmos";
import {
  diagnoseRecvCoinAmountsByEventType,
  sumRecvCoinAmountsFromTxEvents,
} from "../src/lib/ibcRecvEventAmounts";
import { msgIndicesMatchingTypeUrl } from "../src/lib/txEventMsgIndex";
import {
  describeTxResultsLengthMismatch,
  pairedTxCount,
} from "../src/lib/blockTxResultsPairing";
import { rpcCallWithFallback, type RpcBlockResponse, type RpcBlockResultsResponse } from "../src/lib/rpc";
import { MSG_RECV_PACKET, TX_SUCCESS_CODE } from "../src/lib/semantics";

const DEFAULT_RPC = "https://main-a.rpc.agoric.net";

function parseArgs(argv: string[]) {
  let heightStr = "";
  let txIndexStr = "";
  let findFirstRecv = "";
  let rpcCliOverride: string | null = null;
  for (const a of argv) {
    if (a.startsWith("--height=")) heightStr = a.slice("--height=".length);
    else if (a.startsWith("--tx-index=")) txIndexStr = a.slice("--tx-index=".length);
    else if (a.startsWith("--find-first-recv=")) findFirstRecv = a.slice("--find-first-recv=".length);
    else if (a.startsWith("--rpc=")) rpcCliOverride = a.slice("--rpc=".length);
  }
  const rpcUrls: readonly string[] =
    rpcCliOverride !== null
      ? [rpcCliOverride]
      : [process.env.RPC_URL ?? DEFAULT_RPC, process.env.RPC_URL_FALLBACK ?? ""];
  return { heightStr, txIndexStr, findFirstRecv, rpcUrls };
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

function mapToRecord(m: Map<string, bigint>): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    o[k] = v.toString();
  }
  return o;
}

function txHashFromB64(b64: string): string {
  const raw = Buffer.from(b64, "base64");
  return createHash("sha256").update(raw).digest("hex").toUpperCase();
}

async function fetchBlockPair(
  rpcUrls: readonly string[],
  height: bigint
): Promise<{ block: RpcBlockResponse; results: RpcBlockResultsResponse }> {
  const hStr = height.toString();
  const [block, results] = await Promise.all([
    rpcCallWithFallback<RpcBlockResponse>(rpcUrls, "block", { height: hStr }),
    rpcCallWithFallback<RpcBlockResultsResponse>(rpcUrls, "block_results", { height: hStr }),
  ]);
  return { block, results };
}

function printEventSummary(events: ReadonlyArray<{ type: string; attributes: { key: string; value: string }[] }>) {
  const interesting = new Set(["coin_received", "transfer", "recv_packet"]);
  let n = 0;
  for (const ev of events) {
    if (!interesting.has(ev.type)) continue;
    const attrs = ev.attributes
      .filter((a) => ["amount", "msg_index", "receiver", "sender", "recipient"].includes(a.key))
      .map((a) => `${a.key}=${JSON.stringify(a.value)}`)
      .join(" ");
    console.log(`  [${ev.type}] ${attrs}`);
    n += 1;
  }
  if (n === 0) console.log("  (no coin_received / transfer / recv_packet events with listed keys)");
}

async function main() {
  const { heightStr, txIndexStr, findFirstRecv, rpcUrls } = parseArgs(process.argv.slice(2));

  let height: bigint;
  let txIndex: number;
  let cached: { block: RpcBlockResponse; results: RpcBlockResultsResponse } | null = null;

  if (findFirstRecv) {
    height = BigInt(findFirstRecv);
    cached = await fetchBlockPair(rpcUrls, height);
    const { block, results } = cached;
    const txsB64 = block.block.data?.txs ?? [];
    const txResults = results.txs_results ?? [];
    const n = pairedTxCount(txsB64.length, txResults.length);
    const mismatch = describeTxResultsLengthMismatch(txsB64.length, txResults.length);
    if (mismatch) console.error(`[inspect] height ${height}: ${mismatch}`);
    let found: number | null = null;
    for (let i = 0; i < n; i++) {
      const tr = txResults[i]!;
      if (tr.code !== TX_SUCCESS_CODE) continue;
      let decoded;
      try {
        decoded = decodeTxRawTx(fromBase64(txsB64[i]!));
      } catch {
        continue;
      }
      let recv = 0;
      for (const msg of decoded.body.messages) {
        if ((msg as EncodeObject).typeUrl === MSG_RECV_PACKET) recv += 1;
      }
      if (recv > 0) {
        found = i;
        break;
      }
    }
    if (found === null) {
      console.error(`[inspect] no successful MsgRecvPacket tx in first ${n} pairs at height ${height}`);
      process.exit(2);
    }
    txIndex = found;
    console.error(`[inspect] --find-first-recv: using tx_index=${txIndex}`);
  } else {
    if (!heightStr || txIndexStr === "") {
      console.error(
        "Usage: npx tsx scripts/inspectIbcRecvTxEventAmounts.ts --height=H --tx-index=I\n   or: npx tsx scripts/inspectIbcRecvTxEventAmounts.ts --find-first-recv=H [--rpc=URL]"
      );
      process.exit(1);
    }
    height = BigInt(heightStr);
    txIndex = Number(txIndexStr);
    if (!Number.isInteger(txIndex) || txIndex < 0) {
      console.error("[inspect] --tx-index must be a non-negative integer");
      process.exit(1);
    }
  }

  const { block, results } = cached ?? (await fetchBlockPair(rpcUrls, height));
  const txsB64 = block.block.data?.txs ?? [];
  const txResults = results.txs_results ?? [];
  const hHeader = block.block.header.height;
  if (txIndex >= txsB64.length || txIndex >= (txResults?.length ?? 0)) {
    console.error(`[inspect] tx_index ${txIndex} out of range (block has ${txsB64.length} txs)`);
    process.exit(1);
  }

  const tr = txResults[txIndex]!;
  if (tr.code !== TX_SUCCESS_CODE) {
    console.error(`[inspect] tx ${txIndex} is not successful (code ${tr.code})`);
    process.exit(2);
  }

  const rawB64 = txsB64[txIndex]!;
  const decoded = decodeTxRawTx(fromBase64(rawB64));
  const msgs = decoded.body.messages;
  let recvPacketCount = 0;
  for (const msg of msgs) {
    if ((msg as EncodeObject).typeUrl === MSG_RECV_PACKET) recvPacketCount += 1;
  }
  if (recvPacketCount === 0) {
    console.error("[inspect] tx has no MsgRecvPacket — pick another tx_index or use --find-first-recv");
    process.exit(2);
  }

  const recvPacketMsgIndices = msgIndicesMatchingTypeUrl(
    msgs as ReadonlyArray<{ typeUrl: string }>,
    MSG_RECV_PACKET
  );
  const events = asEventKV(txResults)[txIndex] ?? [];

  const combined = sumRecvCoinAmountsFromTxEvents(events, { recvPacketMsgIndices });
  const diag = diagnoseRecvCoinAmountsByEventType(events, { recvPacketMsgIndices });

  const out = {
    chainContext: {
      height: hHeader,
      txIndex,
      txHash: txHashFromB64(rawB64),
      rpcPrimary: rpcUrls[0],
    },
    msgRecvPacketCount: recvPacketCount,
    recvPacketMsgIndices: [...recvPacketMsgIndices.values()].sort((a, b) => a - b),
    ibcTransferAmountInModel: {
      combined: mapToRecord(combined),
      fromCoinReceivedOnly: mapToRecord(diag.fromCoinReceived),
      fromTransferOnly: mapToRecord(diag.fromTransfer),
      usedMsgIndexFilter: diag.usedMsgIndexFilter,
      usedLegacyFallback: diag.usedLegacyFallback,
    },
    interpretationHint:
      "If for a denom, fromCoinReceivedOnly + fromTransferOnly ≈ combined and both legs are non-zero, the same movement may be represented twice (SDK-dependent). bank_credits_volume uses coin_received only — see methodology.",
  };

  console.error(`[inspect] relevant events (subset of keys):`);
  printEventSummary(events);
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
