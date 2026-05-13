/**
 * Scan Agoric blocks for a UTC calendar day and list MsgRecvPacket txs whose
 * coin_received / transfer events include given IBC denoms (same parsing as
 * `sumRecvCoinAmountsFromTxEvents` / the indexer, including msg_index scoping when present). Use to
 * investigate IBC "in" spikes in daily_metrics.
 *
 * Usage:
 *   RPC_URL=https://main-a.rpc.agoric.net npx tsx scripts/scanIbcRecvDay.ts --day=2026-04-01
 *   npx tsx scripts/scanIbcRecvDay.ts --day=2026-04-01 --denom=ibc/ABC... --denom=ibc/DEF...
 *
 * Env:
 *   RPC_URL (default: https://main-a.rpc.agoric.net)
 *   SCAN_CONCURRENCY — parallel block fetches (default 12; use 4 if the node rate-limits)
 *   SCAN_HEIGHT_START + SCAN_HEIGHT_END_EXCLUSIVE — optional decimal heights (skip time→height search;
 *     both required together; end is exclusive). Block RPC calls retry on transient failures.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { fromBase64 } from "@cosmjs/encoding";
import type { EncodeObject } from "@cosmjs/proto-signing";
import { decodeTxRawTx } from "../src/lib/cosmos";
import { sumRecvCoinAmountsFromTxEvents } from "../src/lib/ibcRecvEventAmounts";
import { msgIndicesMatchingTypeUrl } from "../src/lib/txEventMsgIndex";
import {
  rpcCallWithFallback,
  type RpcBlockResponse,
  type RpcBlockResultsResponse,
} from "../src/lib/rpc";
import {
  describeTxResultsLengthMismatch,
  pairedTxCount,
} from "../src/lib/blockTxResultsPairing";
import { MSG_RECV_PACKET, TX_SUCCESS_CODE } from "../src/lib/semantics";

const DEFAULT_RPC = "https://main-a.rpc.agoric.net";

/** Default: both "AXL" ibc hash rows in src/config/denoms.json (different paths). */
const DEFAULT_TARGET_DENOMS = [
  "ibc/3763997B746CA5FDC9883C5192B783B114A4610E1A37751955288E0940BB0B7F",
  "ibc/C01154C2547F4CB10A985EA78E7CD4BA891C1504360703A37E1D7043F06B5E1F",
];

function parseArgs(argv: string[]) {
  let day = "";
  let rpcCliOverride: string | null = null;
  const denoms: string[] = [];
  for (const a of argv) {
    if (a.startsWith("--day=")) day = a.slice("--day=".length);
    else if (a.startsWith("--rpc=")) rpcCliOverride = a.slice("--rpc=".length);
    else if (a.startsWith("--denom=")) denoms.push(a.slice("--denom=".length));
  }
  // Explicit --rpc=URL disables the env-based fallback so debug invocations stay scoped to one node.
  const rpcUrls: readonly string[] =
    rpcCliOverride !== null
      ? [rpcCliOverride]
      : [process.env.RPC_URL ?? DEFAULT_RPC, process.env.RPC_URL_FALLBACK ?? ""];
  return { day, rpcUrls, denoms: denoms.length > 0 ? denoms : DEFAULT_TARGET_DENOMS };
}

function utcDayBounds(dayStr: string): { startMs: number; endMs: number; day: string } {
  const m = dayStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`--day must be YYYY-MM-DD, got ${dayStr}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const startMs = Date.UTC(y, mo - 1, d, 0, 0, 0, 0);
  const endMs = Date.UTC(y, mo - 1, d + 1, 0, 0, 0, 0);
  return { startMs, endMs, day: dayStr };
}

function txHashFromB64(b64: string): string {
  const raw = Buffer.from(b64, "base64");
  return createHash("sha256").update(raw).digest("hex").toUpperCase();
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** Batch scanners hit rate limits and transient node faults — retry any RPC failure with backoff. */
async function rpcCallRetry<T>(
  rpcUrls: readonly string[],
  method: string,
  params: unknown
): Promise<T> {
  const max = 8;
  let last: unknown;
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      return await rpcCallWithFallback<T>(rpcUrls, method, params);
    } catch (e) {
      last = e;
      if (attempt === max) throw e;
      await sleep(250 * 2 ** (attempt - 1));
    }
  }
  throw last;
}

async function latestHeight(rpcUrls: readonly string[]): Promise<bigint> {
  const st = await rpcCallWithFallback<{ sync_info: { latest_block_height: string } }>(
    rpcUrls,
    "status",
    {}
  );
  return BigInt(st.sync_info.latest_block_height);
}

/**
 * Some RPC nodes report a "lowest height" but still return `result.block: null` at that edge.
 * Treat missing header time like pruned / unavailable.
 * Retries transient HTTP failures — treating them as "no block" corrupts binary search for heights.
 */
async function blockTimeMsAtHeightOrNull(
  rpcUrls: readonly string[],
  height: bigint
): Promise<number | null> {
  const block = await rpcCallRetry<RpcBlockResponse>(rpcUrls, "block", { height: height.toString() });
  const t = block.block?.header?.time;
  if (!t) return null;
  const ms = new Date(t).getTime();
  return Number.isFinite(ms) ? ms : null;
}

async function findEarliestQueryableHeight(rpcUrls: readonly string[], tip: bigint): Promise<bigint> {
  let lo = BigInt(1);
  let hi = tip;
  while (lo < hi) {
    const mid = (lo + hi) / BigInt(2);
    const ok = (await blockTimeMsAtHeightOrNull(rpcUrls, mid)) !== null;
    if (ok) hi = mid;
    else lo = mid + BigInt(1);
  }
  return lo;
}

/** Walk forward until we see a real header (handles sparse null `block` responses at prune edge). */
async function firstQueryableHeightFrom(
  rpcUrls: readonly string[],
  start: bigint,
  tip: bigint
): Promise<bigint> {
  let h = start;
  while (h <= tip) {
    if ((await blockTimeMsAtHeightOrNull(rpcUrls, h)) !== null) return h;
    h += BigInt(1);
  }
  return tip + BigInt(1);
}

/** First height whose block time is >= targetMs. */
async function findHeightAtOrAfterTime(
  rpcUrls: readonly string[],
  targetMs: number,
  tip: bigint
): Promise<bigint> {
  let earliestQueryable = await findEarliestQueryableHeight(rpcUrls, tip);
  earliestQueryable = await firstQueryableHeightFrom(rpcUrls, earliestQueryable, tip);
  const earliestMs = await blockTimeMsAtHeightOrNull(rpcUrls, earliestQueryable);
  if (earliestMs === null) return tip + BigInt(1);
  if (targetMs <= earliestMs) return earliestQueryable;

  const tipMs = await blockTimeMsAtHeightOrNull(rpcUrls, tip);
  if (tipMs === null) throw new Error("Tip block has no header time");
  if (targetMs > tipMs) return tip + BigInt(1);

  let lo = earliestQueryable;
  let hi = tip;
  while (lo < hi) {
    const mid = (lo + hi) / BigInt(2);
    const midMs = await blockTimeMsAtHeightOrNull(rpcUrls, mid);
    if (midMs === null) {
      lo = mid + BigInt(1);
      continue;
    }
    if (midMs < targetMs) lo = mid + BigInt(1);
    else hi = mid;
  }
  return await firstQueryableHeightFrom(rpcUrls, lo, tip);
}

async function fetchBlockPair(
  rpcUrls: readonly string[],
  height: bigint
): Promise<{ block: RpcBlockResponse; results: RpcBlockResultsResponse }> {
  const hStr = height.toString();
  const [block, results] = await Promise.all([
    rpcCallRetry<RpcBlockResponse>(rpcUrls, "block", { height: hStr }),
    rpcCallRetry<RpcBlockResultsResponse>(rpcUrls, "block_results", { height: hStr }),
  ]);
  return { block, results };
}

function eventsFromTxResults(
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

interface HitRow {
  height: string;
  txIndex: number;
  /** Count of MsgRecvPacket in this tx. */
  recvPacketCount: number;
  blockTime: string;
  txHash: string;
  denoms: Record<string, string>;
}

async function main() {
  const { day, rpcUrls, denoms } = parseArgs(process.argv.slice(2));
  if (!day) {
    console.error("Usage: npx tsx scripts/scanIbcRecvDay.ts --day=YYYY-MM-DD [--rpc=URL] [--denom=ibc/... ...]");
    process.exit(1);
  }

  const { startMs, endMs, day: dayLabel } = utcDayBounds(day);
  const targetSet = new Set(denoms);
  const concurrency = Math.max(1, Math.min(64, Number(process.env.SCAN_CONCURRENCY ?? "12")));

  const tip = await latestHeight(rpcUrls);
  const hs = process.env.SCAN_HEIGHT_START;
  const he = process.env.SCAN_HEIGHT_END_EXCLUSIVE;
  let hStart: bigint;
  let hEndExclusive: bigint;
  if (hs !== undefined && he !== undefined && hs.length > 0 && he.length > 0) {
    hStart = BigInt(hs);
    hEndExclusive = BigInt(he);
    console.error("[scanIbcRecvDay] using SCAN_HEIGHT_START / SCAN_HEIGHT_END_EXCLUSIVE (skip time lookup)");
  } else {
    hStart = await findHeightAtOrAfterTime(rpcUrls, startMs, tip);
    hEndExclusive = await findHeightAtOrAfterTime(rpcUrls, endMs, tip);
  }

  console.error(
    `[scanIbcRecvDay] RPC primary=${rpcUrls[0]} fallback=${rpcUrls[1] || "<none>"} day=${dayLabel} UTC [${new Date(startMs).toISOString()}, ${new Date(endMs).toISOString()})`
  );
  console.error(
    `[scanIbcRecvDay] heights ${hStart.toString()} .. ${(hEndExclusive - BigInt(1)).toString()} (${(hEndExclusive - hStart).toString()} blocks), concurrency=${concurrency}`
  );
  console.error(`[scanIbcRecvDay] target denoms (${denoms.length}):`);
  for (const d of denoms) console.error(`  ${d}`);

  if (hStart >= hEndExclusive) {
    console.error("[scanIbcRecvDay] No blocks in range (wrong network or day beyond tip).");
    process.exit(0);
  }

  const totals = new Map<string, bigint>();
  for (const d of denoms) totals.set(d, BigInt(0));

  const hits: HitRow[] = [];
  let blocksDone = BigInt(0);
  const span = hEndExclusive - hStart;

  let cursor = hStart;
  while (cursor < hEndExclusive) {
    const room = hEndExclusive - cursor;
    const chunkSize =
      room > BigInt(concurrency) ? BigInt(concurrency) : room;
    const heights: bigint[] = [];
    for (let i = BigInt(0); i < chunkSize; i++) {
      heights.push(cursor + i);
    }
    cursor += chunkSize;

    const pairs = await Promise.all(heights.map((h) => fetchBlockPair(rpcUrls, h)));

    for (let pi = 0; pi < pairs.length; pi++) {
      const { block, results } = pairs[pi]!;
      const headerTime = block.block.header.time;
      const heightStr = block.block.header.height;
      const txsB64 = block.block.data?.txs ?? [];
      const txResults = results.txs_results ?? [];
      const eventsPerTx = eventsFromTxResults(txResults);
      const blockTxCount = txsB64.length;
      const resultsCount = txResults.length;
      const mismatchDetail = describeTxResultsLengthMismatch(blockTxCount, resultsCount);
      if (mismatchDetail) {
        console.warn(`[scanIbcRecvDay] height ${heightStr}: ${mismatchDetail}`);
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

        const txHash = txHashFromB64(txsB64[i]!);
        const msgs = decoded.body.messages;

        let recvPacketCount = 0;
        for (const msg of msgs) {
          if ((msg as EncodeObject).typeUrl === MSG_RECV_PACKET) recvPacketCount += 1;
        }
        if (recvPacketCount === 0) continue;

        const recvIdx = msgIndicesMatchingTypeUrl(
          msgs as ReadonlyArray<{ typeUrl: string }>,
          MSG_RECV_PACKET
        );
        const allRecv = sumRecvCoinAmountsFromTxEvents(eventsPerTx[i] ?? [], {
          recvPacketMsgIndices: recvIdx,
        });
        const amounts = new Map<string, bigint>();
        for (const [d, v] of allRecv) {
          if (targetSet.has(d)) amounts.set(d, v);
        }
        if (amounts.size === 0) continue;

        const denomsOut: Record<string, string> = {};
        for (const [d, v] of amounts) {
          denomsOut[d] = v.toString();
          totals.set(d, (totals.get(d) ?? BigInt(0)) + v);
        }

        hits.push({
          height: heightStr,
          txIndex: i,
          recvPacketCount,
          blockTime: headerTime,
          txHash,
          denoms: denomsOut,
        });
      }
    }

    blocksDone += chunkSize;
    if (Number(blocksDone) % 500 === 0 || blocksDone === span) {
      console.error(`[scanIbcRecvDay] scanned ${blocksDone.toString()} / ${span.toString()} blocks...`);
    }
  }

  console.error("\n=== Totals (minimal units, once-per-tx; matches indexer `ibc_transfer_amount_in`) ===");
  for (const d of denoms) {
    console.error(`${d}: ${(totals.get(d) ?? BigInt(0)).toString()}`);
  }

  console.error(`\n=== Matching MsgRecvPacket rows: ${hits.length} ===\n`);

  const totalsOut: Record<string, string> = {};
  for (const [k, v] of totals) totalsOut[k] = v.toString();

  console.log(
    JSON.stringify(
      // Preserve historical `rpc` field shape (primary URL string). Fallback,
      // when set, is visible in stderr logs above — not in stdout JSON, to
      // avoid changing the consumed output schema.
      { day: dayLabel, rpc: rpcUrls[0], denoms, hits, totals: totalsOut },
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
