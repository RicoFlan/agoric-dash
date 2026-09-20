/**
 * Backfill `provision_pool_day` from `published.provisionPool.metrics` over history.
 *
 * Replays `block_results` from INDEXER_START_DATE (or BACKFILL_FROM_HEIGHT) through the indexer
 * cursor (or BACKFILL_TO_HEIGHT), decoding the provision pool's cumulative counters out of the
 * EndBlock vstorage `state_change` events and keeping the last reading per UTC day. Writes ONLY
 * `provision_pool_day`; no metric series and no other table is read or modified. Never runs
 * reindex:reset.
 *
 * **There is no destructive mode, on purpose.** Every other backfill here writes additive rollups,
 * where a replay double-counts, so each needs a delete-and-rebuild path and a checkpoint guarding
 * resume. This one upserts a day keyed by day, highest height wins (provisionPoolRollup.ts), so a
 * replayed range rewrites the same rows with the same values. That makes it safe to re-run at any
 * time, safe to run while the live indexer is writing, and safe to interrupt — which is why it does
 * not take BACKFILL_SKIP_DELETE and does not delete anything.
 *
 * A checkpoint is still written so a long run can resume without redoing work, but losing it costs
 * time, never correctness.
 *
 * Env: DATABASE_URL, RPC_URL[, RPC_URL_FALLBACK], INDEXER_START_DATE, BACKFILL_FROM_HEIGHT,
 *      BACKFILL_TO_HEIGHT, BACKFILL_BATCH (1000), BACKFILL_CONCURRENCY (16),
 *      INDEXER_RPC_RETRIES (6)
 *
 * Run: npm run backfill:provision-pool
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../src/db/schema";
import { backfillCheckpoint, indexerState } from "../src/db/schema";
import { ensureBackfillCheckpointTable, ensureProvisionPoolDayTable } from "../src/db/ensureAdditiveTables";
import {
  accumulateProvisionPoolFromBlock,
  persistProvisionPool,
  ProvisionPoolAccumulator,
} from "../src/lib/provisionPoolRollup";
import { rpcCallWithFallback, type RpcBlockResultsResponse } from "../src/lib/rpc";

const TAG = "[backfillProvisionPool]";
const DATABASE_URL = process.env.DATABASE_URL;
const RPC_URLS: readonly string[] = [
  process.env.RPC_URL ?? "https://main-a.rpc.agoric.net",
  process.env.RPC_URL_FALLBACK ?? "",
];
const START_DATE_ISO = process.env.INDEXER_START_DATE ?? "2026-01-01T00:00:00Z";
const START_DATE_MS = new Date(START_DATE_ISO).getTime();
const BATCH = Math.max(1, Number(process.env.BACKFILL_BATCH ?? "1000"));
const CONCURRENCY = Math.max(1, Math.min(64, Number(process.env.BACKFILL_CONCURRENCY ?? "16")));
const RPC_RETRIES = Math.max(1, Number(process.env.INDEXER_RPC_RETRIES ?? "6"));
const JOB = "provision_pool";

if (!DATABASE_URL) {
  console.error(`${TAG} DATABASE_URL is required`);
  process.exit(1);
}
if (!Number.isFinite(START_DATE_MS)) {
  console.error(`${TAG} INDEXER_START_DATE must be a valid ISO datetime`);
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function latestHeight(): Promise<bigint> {
  const st = await rpcCallWithFallback<{ sync_info: { latest_block_height: string } }>(RPC_URLS, "status", {});
  return BigInt(st.sync_info.latest_block_height);
}

async function blockTimeMs(height: bigint): Promise<number> {
  const b = await rpcCallWithFallback<{ block: { header: { time: string } } }>(RPC_URLS, "block", {
    height: height.toString(),
  });
  const ms = new Date(b.block.header.time).getTime();
  if (!Number.isFinite(ms)) throw new Error(`invalid block time at ${height}`);
  return ms;
}

/** First height at or after `targetMs`, by binary search over the chain's own timestamps. */
async function findStartHeight(targetMs: number, tip: bigint): Promise<bigint> {
  let lo = BigInt(1);
  let hi = tip;
  while (lo < hi) {
    const mid = (lo + hi) / BigInt(2);
    // A height the archive cannot serve (genesis-era answers a generic Internal error) is treated
    // as "too early" so the search moves up rather than aborting the run.
    const ok = await blockTimeMs(mid).then((ms) => ms >= targetMs, () => false);
    if (ok) hi = mid;
    else lo = mid + BigInt(1);
  }
  return lo;
}

async function fetchBlock(height: bigint): Promise<{ results: RpcBlockResultsResponse; timeIso: string }> {
  const hStr = height.toString();
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RPC_RETRIES; attempt++) {
    try {
      const [results, block] = await Promise.all([
        rpcCallWithFallback<RpcBlockResultsResponse>(RPC_URLS, "block_results", { height: hStr }),
        rpcCallWithFallback<{ block: { header: { time: string } } }>(RPC_URLS, "block", { height: hStr }),
      ]);
      // A pruned fallback answers old heights with `block: null` and empty results rather than an
      // error; treat that as a failed attempt so the retry goes back to the archive primary.
      if (!results || typeof results !== "object" || Array.isArray(results) || !block?.block?.header?.time) {
        throw new Error(`empty response at ${hStr} (pruned node?)`);
      }
      if (String((results as { height?: unknown }).height ?? "") !== hStr) {
        throw new Error(`block_results height mismatch at ${hStr}`);
      }
      return { results, timeIso: block.block.header.time };
    } catch (e) {
      lastErr = e;
      const backoff = Math.min(30_000, 400 * 2 ** (attempt - 1));
      console.warn(`${TAG} height ${hStr} attempt ${attempt}/${RPC_RETRIES} failed; retry in ${backoff}ms`);
      if (attempt < RPC_RETRIES) await sleep(backoff);
    }
  }
  throw lastErr;
}

async function main() {
  await ensureBackfillCheckpointTable(db);
  await ensureProvisionPoolDayTable(db);

  const tip = await latestHeight();
  const cursorRow = await db.select().from(indexerState).limit(1);
  const cursor = cursorRow[0]?.lastIndexedHeight ?? tip;

  let fromH: bigint;
  if (process.env.BACKFILL_FROM_HEIGHT) {
    fromH = BigInt(process.env.BACKFILL_FROM_HEIGHT);
  } else {
    const cp = await db.select().from(backfillCheckpoint).where(eq(backfillCheckpoint.job, JOB)).limit(1);
    const last = cp[0]?.lastHeight ?? null;
    // Resuming from the checkpoint is an optimisation, not a safety requirement: re-reading a
    // committed range would rewrite the same day rows with the same values.
    fromH = last !== null ? last + BigInt(1) : await findStartHeight(START_DATE_MS, tip);
    if (last !== null) console.error(`${TAG} resuming above checkpoint ${last}`);
  }
  const toH = process.env.BACKFILL_TO_HEIGHT ? BigInt(process.env.BACKFILL_TO_HEIGHT) : cursor;
  if (fromH > toH) {
    console.error(`${TAG} fromHeight ${fromH} > toHeight ${toH}, nothing to do.`);
    await pool.end();
    return;
  }

  const total = toH - fromH + BigInt(1);
  console.error(
    `${TAG} heights ${fromH}..${toH} (${total} blocks) batch=${BATCH} concurrency=${CONCURRENCY} — upsert-only, nothing is deleted`
  );

  const t0 = Date.now();
  let processed = 0;
  let daysWritten = 0;

  for (let h = fromH; h <= toH; ) {
    const batchEnd = h + (toH - h + BigInt(1) < BigInt(BATCH) ? toH - h + BigInt(1) : BigInt(BATCH)) - BigInt(1);
    const acc = new ProvisionPoolAccumulator();

    for (let chunkStart = h; chunkStart <= batchEnd; ) {
      const heights: bigint[] = [];
      for (let k = chunkStart; k <= batchEnd && heights.length < CONCURRENCY; k++) heights.push(k);
      const fetched = await Promise.all(heights.map((hh) => fetchBlock(hh)));
      for (let i = 0; i < heights.length; i++) {
        const f = fetched[i]!;
        accumulateProvisionPoolFromBlock(f.results, heights[i]!, f.timeIso, acc);
      }
      chunkStart = heights[heights.length - 1]! + BigInt(1);
    }

    daysWritten += acc.size;
    await persistProvisionPool(db, acc);
    // The checkpoint is a resume hint, written after the rows it covers so a crash re-reads rather
    // than skips. Re-reading is harmless here; skipping would leave a day unwritten.
    await db
      .insert(backfillCheckpoint)
      .values({ job: JOB, lastHeight: batchEnd, updatedAt: new Date() })
      .onConflictDoUpdate({ target: backfillCheckpoint.job, set: { lastHeight: batchEnd, updatedAt: new Date() } });

    processed += Number(batchEnd - h + BigInt(1));
    const pct = ((processed / Number(total)) * 100).toFixed(1);
    console.error(
      `${TAG} ${processed}/${total} blocks (${pct}%) through height ${batchEnd} — ${acc.size} day rows this batch; ${Math.round((Date.now() - t0) / 1000)}s`
    );
    h = batchEnd + BigInt(1);
  }

  console.error(`${TAG} done — ${daysWritten} day-row writes over ${processed} blocks`);
  await pool.end();
}

main().catch(async (e) => {
  console.error(`${TAG} failed:`, e);
  await pool.end().catch(() => {});
  process.exit(1);
});
