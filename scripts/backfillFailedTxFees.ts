/**
 * Backfill the fees paid by FAILED transactions, which the indexer skipped before P7.4.
 *
 * A Cosmos fee is deducted by the ante handler and committed even when message execution later
 * fails. Our rollup previously stopped at `if (!ok) continue;` before extracting fees, so every
 * post-ante failure is missing from `fee_paid` and `address_fee_day`. Confirmed on agoric-3: of 68
 * failed txs sampled, 20 carried a committed `fee` attribute and 48 (ante failures) carried none.
 *
 * ADDITIVE-ONLY BY NECESSITY. Unlike the other backfills there is no full mode, because we cannot
 * delete "just the failed-tx part" of an existing fee_paid row. Re-running an already-committed
 * range would therefore double-count, so this job refuses to start inside a range it has already
 * written: it keeps a `backfill_checkpoint` row (job `failed_tx_fees`) inside each batch
 * transaction, and a later run must start strictly above it.
 *
 * Touches only `fee_paid` in daily/hourly metrics and `address_fee_day`. Never runs reindex:reset.
 *
 * Env: DATABASE_URL, RPC_URL[, RPC_URL_FALLBACK], INDEXER_START_DATE, BACKFILL_FROM_HEIGHT,
 *      BACKFILL_TO_HEIGHT, BACKFILL_BATCH (1000), BACKFILL_CONCURRENCY (16), INDEXER_RPC_RETRIES (8)
 * Run: npm run backfill:failed-fees
 */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../src/db/schema";
import { ensureBackfillCheckpointTable } from "../src/db/ensureAdditiveTables";
import { requirePositiveInt } from "../src/lib/envNumbers";
import { pairedTxCount } from "../src/lib/blockTxResultsPairing";
import { extractFeePayerFromEvents, extractPaidFeesFromEvents } from "../src/lib/cosmos";
import { rpcCallWithFallback, type RpcBlockResponse, type RpcBlockResultsResponse } from "../src/lib/rpc";
import { SERIES, TX_SUCCESS_CODE } from "../src/lib/semantics";

const TAG = "[backfillFailedTxFees]";
const JOB = "failed_tx_fees";
const DATABASE_URL = process.env.DATABASE_URL;
const RPC_URLS: readonly string[] = [process.env.RPC_URL ?? "https://main-a.rpc.agoric.net", process.env.RPC_URL_FALLBACK ?? ""];
const START_DATE_MS = new Date(process.env.INDEXER_START_DATE ?? "2026-01-01T00:00:00Z").getTime();
let BATCH = 1000;
let CONCURRENCY = 16;
let RPC_RETRIES = 8;
try {
  BATCH = requirePositiveInt("BACKFILL_BATCH", process.env.BACKFILL_BATCH, 1000, { max: 100_000 });
  CONCURRENCY = requirePositiveInt("BACKFILL_CONCURRENCY", process.env.BACKFILL_CONCURRENCY, 16, { max: 64 });
  RPC_RETRIES = requirePositiveInt("INDEXER_RPC_RETRIES", process.env.INDEXER_RPC_RETRIES, 8, { max: 100 });
} catch (e) {
  console.error(`${TAG} ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
const ROLLUP_KEY_DELIM = "\0";

if (!DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema });
const { dailyMetrics, hourlyMetrics, addressFeeDay, indexerState, backfillCheckpoint } = schema;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

async function latestHeight(): Promise<bigint> {
  const st = await rpcCallWithFallback<{ sync_info: { latest_block_height: string } }>(RPC_URLS, "status", {});
  return BigInt(st.sync_info.latest_block_height);
}
async function blockTimeMs(h: bigint): Promise<number> {
  const b = await rpcCallWithFallback<RpcBlockResponse>(RPC_URLS, "block", { height: h.toString() });
  const ms = new Date(b.block.header.time).getTime();
  if (!Number.isFinite(ms)) throw new Error(`Invalid block time at ${h}`);
  return ms;
}
/**
 * True when the height is served, false only when the node reports it as unavailable or pruned.
 * A transient error must NOT read as "pruned": the binary search would discard every lower height
 * and the job would checkpoint past a range it never filled.
 */
async function heightIsAvailable(h: bigint): Promise<boolean> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RPC_RETRIES; attempt++) {
    try {
      await blockTimeMs(h);
      return true;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
      if (/pruned|not available|height .*is not available|lowest height|must be less than or equal/.test(msg)) return false;
      if (attempt < RPC_RETRIES) await sleep(Math.min(30_000, 400 * 2 ** (attempt - 1)));
    }
  }
  throw new Error(`could not determine availability of height ${h}: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

async function findStartHeight(targetMs: number, tip: bigint): Promise<bigint> {
  let lo = BigInt(1);
  let hi = tip;
  while (lo < hi) {
    const mid = (lo + hi) / BigInt(2);
    if (await heightIsAvailable(mid)) hi = mid;
    else lo = mid + BigInt(1);
  }
  let a = lo;
  let b = tip;
  while (a < b) {
    const mid = (a + b) / BigInt(2);
    if ((await blockTimeMs(mid)) < targetMs) a = mid + BigInt(1);
    else b = mid;
  }
  return a;
}
async function getCursor(): Promise<bigint> {
  const rows = await db.select().from(indexerState).where(eq(indexerState.id, "singleton")).limit(1);
  return rows[0]?.lastIndexedHeight ?? BigInt(0);
}

async function fetchPair(height: bigint): Promise<{ block: RpcBlockResponse; results: RpcBlockResultsResponse }> {
  const hStr = height.toString();
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RPC_RETRIES; attempt++) {
    try {
      const [block, results] = await Promise.all([
        rpcCallWithFallback<RpcBlockResponse>(RPC_URLS, "block", { height: hStr }),
        rpcCallWithFallback<RpcBlockResultsResponse>(RPC_URLS, "block_results", { height: hStr }),
      ]);
      if (!block?.block?.header?.time || !results || typeof results !== "object" || Array.isArray(results)) {
        throw new Error(`empty response at ${hStr} (pruned node?)`);
      }
      if (String((results as { height?: unknown }).height ?? "") !== hStr) throw new Error(`height mismatch at ${hStr}`);
      return { block, results };
    } catch (e) {
      lastErr = e;
      const backoff = Math.min(30_000, 400 * 2 ** (attempt - 1));
      console.warn(`${TAG} height ${hStr} attempt ${attempt}/${RPC_RETRIES} failed; retry in ${backoff}ms`);
      if (attempt < RPC_RETRIES) await sleep(backoff);
    }
  }
  throw lastErr;
}

type EventKV = { type: string; attributes: { key: string; value: string }[] };
function eventsOf(tr: { events?: EventKV[] }): EventKV[] {
  return tr.events ?? [];
}

function bump(m: Map<string, bigint>, key: string, delta: bigint) {
  if (delta === BigInt(0)) return;
  m.set(key, (m.get(key) ?? BigInt(0)) + delta);
}

async function persist(daily: Map<string, bigint>, hourly: Map<string, bigint>, feeDeltas: Map<string, bigint>, lastHeight: bigint) {
  await db.transaction(async (tx) => {
    for (const [key, delta] of daily) {
      const [day, series, dimension] = key.split(ROLLUP_KEY_DELIM);
      await tx
        .insert(dailyMetrics)
        .values({ day, series, dimension, value: delta.toString() })
        .onConflictDoUpdate({ target: [dailyMetrics.day, dailyMetrics.series, dailyMetrics.dimension], set: { value: sql`${dailyMetrics.value} + ${sql.raw("excluded.value")}` } });
    }
    for (const [key, delta] of hourly) {
      const [iso, series, dimension] = key.split(ROLLUP_KEY_DELIM);
      await tx
        .insert(hourlyMetrics)
        .values({ hour: new Date(iso), series, dimension, value: delta.toString() })
        .onConflictDoUpdate({ target: [hourlyMetrics.hour, hourlyMetrics.series, hourlyMetrics.dimension], set: { value: sql`${hourlyMetrics.value} + ${sql.raw("excluded.value")}` } });
    }
    for (const [key, delta] of feeDeltas) {
      const [day, address, denom] = key.split(ROLLUP_KEY_DELIM);
      await tx
        .insert(addressFeeDay)
        .values({ day, address, denom, fee: delta.toString() })
        .onConflictDoUpdate({ target: [addressFeeDay.day, addressFeeDay.address, addressFeeDay.denom], set: { fee: sql`${addressFeeDay.fee} + ${sql.raw("excluded.fee")}` } });
    }
    await tx
      .insert(backfillCheckpoint)
      .values({ job: JOB, lastHeight, updatedAt: new Date() })
      .onConflictDoUpdate({ target: backfillCheckpoint.job, set: { lastHeight, updatedAt: new Date() } });
  });
}

async function main() {
  await ensureBackfillCheckpointTable(db);
  const tip = await latestHeight();
  const cursor = await getCursor();
  if (cursor === BigInt(0)) {
    console.error(`${TAG} indexer_state cursor is 0 — run the indexer first.`);
    process.exit(1);
  }
  const cp = await db.select().from(backfillCheckpoint).where(eq(backfillCheckpoint.job, JOB)).limit(1);
  const committed = cp[0]?.lastHeight ?? null;
  /**
   * The live indexer ALSO writes failed-tx fees from the P7.4 deploy onward, and these upserts are
   * additive, so an overlap double-counts. The cutoff therefore cannot default to the live cursor
   * (which moves): the operator must pass the cursor height recorded at the moment of that deploy.
   */
  if (!process.env.BACKFILL_TO_HEIGHT) {
    console.error(
      `${TAG} BACKFILL_TO_HEIGHT is required: set it to the indexer cursor recorded when the post-ante fee fix deployed. The live indexer already writes these fees above that height, and these upserts are additive, so defaulting to the current cursor (${cursor}) would double-count.`
    );
    process.exit(1);
  }
  const toH = BigInt(process.env.BACKFILL_TO_HEIGHT);
  if (toH > cursor) {
    console.error(`${TAG} BACKFILL_TO_HEIGHT ${toH} is above the indexer cursor ${cursor}; those heights are not indexed yet.`);
    process.exit(1);
  }
  const fromH = process.env.BACKFILL_FROM_HEIGHT ? BigInt(process.env.BACKFILL_FROM_HEIGHT) : await findStartHeight(START_DATE_MS, tip);
  if (committed !== null && fromH <= committed) {
    console.error(
      `${TAG} heights up to ${committed} were already written and these deltas are additive, so replaying them would double-count. Start above it: BACKFILL_FROM_HEIGHT=${(committed + BigInt(1)).toString()}.`
    );
    process.exit(1);
  }
  if (fromH > toH) {
    console.error(`${TAG} fromHeight ${fromH} > toHeight ${toH}, nothing to do.`);
    process.exit(0);
  }
  console.error(`${TAG} heights ${fromH}..${toH} (${(toH - fromH + BigInt(1)).toString()} blocks) batch=${BATCH} concurrency=${CONCURRENCY}`);

  let h = fromH;
  let done = BigInt(0);
  let failedSeen = 0;
  let feePaying = 0;
  const span = toH - fromH + BigInt(1);
  const t0 = Date.now();
  while (h <= toH) {
    const room = toH - h + BigInt(1);
    const batchEnd = h + (room < BigInt(BATCH) ? room : BigInt(BATCH)) - BigInt(1);
    const daily = new Map<string, bigint>();
    const hourly = new Map<string, bigint>();
    const feeDeltas = new Map<string, bigint>();
    let next = h;
    const worker = async () => {
      for (;;) {
        if (next > batchEnd) return;
        const ht = next;
        next += BigInt(1);
        const { block, results } = await fetchPair(ht);
        const iso = block.block.header.time;
        const day = iso.slice(0, 10);
        const hourDate = new Date(iso);
        hourDate.setUTCMinutes(0, 0, 0);
        const hourIso = hourDate.toISOString();
        const txsB64 = block.block.data?.txs ?? [];
        const trs = results.txs_results ?? [];
        // pairedTxCount tolerates a mismatch by taking min(N, M). The indexer can afford that, but
        // here the writes are additive and the checkpoint would move past the skipped txs, which no
        // rerun could recover. So a mismatch aborts instead.
        if (txsB64.length !== trs.length) {
          throw new Error(`block ${ht}: ${txsB64.length} txs but ${trs.length} results; refusing to checkpoint past an unmatched block`);
        }
        const n = pairedTxCount(txsB64.length, trs.length);
        for (let i = 0; i < n; i++) {
          const tr = trs[i]!;
          if (tr.code === TX_SUCCESS_CODE) continue; // successes were already counted by the indexer
          failedSeen += 1;
          const evs = eventsOf(tr as { events?: EventKV[] });
          const fees = extractPaidFeesFromEvents(evs);
          if (fees.size === 0) continue; // ante failure: genuinely paid nothing
          feePaying += 1;
          const payer = extractFeePayerFromEvents(evs);
          for (const [denom, amt] of fees) {
            bump(daily, [day, SERIES.FEE_PAID, denom].join(ROLLUP_KEY_DELIM), amt);
            bump(hourly, [hourIso, SERIES.FEE_PAID, denom].join(ROLLUP_KEY_DELIM), amt);
            if (payer) bump(feeDeltas, [day, payer, denom].join(ROLLUP_KEY_DELIM), amt);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    await persist(daily, hourly, feeDeltas, batchEnd);
    done += batchEnd - h + BigInt(1);
    const pct = Number((done * BigInt(1000)) / span) / 10;
    console.error(`${TAG} ${done}/${span} blocks (${pct}%) through ${batchEnd} — ${failedSeen} failed txs, ${feePaying} of them paid; ${Math.round((Date.now() - t0) / 1000)}s`);
    h = batchEnd + BigInt(1);
  }
  await pool.end();
  console.error(`${TAG} done: ${feePaying} fee-paying failures of ${failedSeen} failed txs`);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
