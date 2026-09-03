/**
 * Backfill the two P2 outputs that the indexer only produces from its deploy height onward:
 *   - `offer_category_participant_day` (day × owner × functional category)
 *   - `offer_outcome_category` in daily_metrics / hourly_metrics (`<category>|<outcome>`)
 *
 * Replays block + block_results from INDEXER_START_DATE (or BACKFILL_FROM_HEIGHT) through the
 * indexer cursor (or BACKFILL_TO_HEIGHT) using `accumulateOfferCategoriesFromBlock` — the same
 * helpers the indexer uses — and writes ONLY these two outputs. No other series or table is read or
 * modified; never runs reindex:reset.
 *
 * Idempotency / modes:
 *   - FULL mode (default, no BACKFILL_SKIP_DELETE): rebuilds history after a category-rule change —
 *     deletes every row of `offer_outcome_category` AND `offer_category` (both metric tables) and
 *     every row of `offer_category_participant_day`, then replays from the start height to the
 *     cursor. Run it with the default BACKFILL_TO_HEIGHT (= cursor at start): rows the live indexer
 *     writes for later heights during the run are appended, never deleted.
 *   - RESUME mode (BACKFILL_SKIP_DELETE=1 + BACKFILL_FROM_HEIGHT): upserts only; participant rows are
 *     ON CONFLICT DO NOTHING and metric deltas are additive, so never re-replay a persisted range.
 *
 * Deploy order: indexer with P2 first (it creates the table and starts writing from the cursor),
 * then run this once with BACKFILL_TO_HEIGHT = the cursor at deploy, BACKFILL_SKIP_DELETE=1 (so the
 * rows the live indexer has already written after the cursor are kept).
 *
 * Env: DATABASE_URL, RPC_URL[, RPC_URL_FALLBACK], INDEXER_START_DATE, BACKFILL_FROM_HEIGHT,
 *      BACKFILL_TO_HEIGHT, BACKFILL_SKIP_DELETE, BACKFILL_BATCH (2000), BACKFILL_CONCURRENCY (12),
 *      INDEXER_RPC_RETRIES (6)
 *
 * Run: npm run backfill:offer-categories
 */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../src/db/schema";
import { ensureOfferCategoryParticipantDayTable } from "../src/db/ensureAdditiveTables";
import { accumulateOfferCategoriesFromBlock, ROLLUP_KEY_DELIM } from "../src/lib/offerCategoryRollup";
import { rpcCallWithFallback, type RpcBlockResponse, type RpcBlockResultsResponse } from "../src/lib/rpc";
import { SERIES } from "../src/lib/semantics";

const TAG = "[backfillOfferCategories]";
const DATABASE_URL = process.env.DATABASE_URL;
const RPC_URL_PRIMARY = process.env.RPC_URL ?? "https://main-a.rpc.agoric.net";
const RPC_URL_FALLBACK = process.env.RPC_URL_FALLBACK ?? "";
const RPC_URLS: readonly string[] = [RPC_URL_PRIMARY, RPC_URL_FALLBACK];
const START_DATE_ISO = process.env.INDEXER_START_DATE ?? "2026-01-01T00:00:00Z";
const START_DATE_MS = new Date(START_DATE_ISO).getTime();
const BATCH = Math.max(1, Number(process.env.BACKFILL_BATCH ?? "2000"));
const CONCURRENCY = Math.max(1, Math.min(128, Number(process.env.BACKFILL_CONCURRENCY ?? "12")));
const RPC_RETRIES = Math.max(1, Number(process.env.INDEXER_RPC_RETRIES ?? "6"));
const BACKFILL_SKIP_DELETE = ["1", "true", "yes"].includes((process.env.BACKFILL_SKIP_DELETE ?? "").trim().toLowerCase());

if (!DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}
if (!Number.isFinite(START_DATE_MS)) {
  console.error("INDEXER_START_DATE must be a valid ISO datetime");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema });
const { dailyMetrics, hourlyMetrics, indexerState, offerCategoryParticipantDay } = schema;
const REBUILT_SERIES = [SERIES.OFFER_OUTCOME_CATEGORY, SERIES.OFFER_CATEGORY] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

async function latestHeight(): Promise<bigint> {
  const st = await rpcCallWithFallback<{ sync_info: { latest_block_height: string } }>(RPC_URLS, "status", {});
  return BigInt(st.sync_info.latest_block_height);
}

async function blockTimeMsAtHeight(height: bigint): Promise<number> {
  const block = await rpcCallWithFallback<RpcBlockResponse>(RPC_URLS, "block", { height: height.toString() });
  const ms = new Date(block.block.header.time).getTime();
  if (!Number.isFinite(ms)) throw new Error(`Invalid block time at height ${height.toString()}`);
  return ms;
}

async function findEarliestQueryableHeight(tip: bigint): Promise<bigint> {
  let lo = BigInt(1);
  let hi = tip;
  while (lo < hi) {
    const mid = (lo + hi) / BigInt(2);
    const ok = await blockTimeMsAtHeight(mid).then(() => true, () => false);
    if (ok) hi = mid;
    else lo = mid + BigInt(1);
  }
  return lo;
}

async function findStartHeightByTime(targetMs: number, tip: bigint): Promise<bigint> {
  const earliest = await findEarliestQueryableHeight(tip);
  if (targetMs <= (await blockTimeMsAtHeight(earliest))) return earliest;
  if (targetMs > (await blockTimeMsAtHeight(tip))) return tip + BigInt(1);
  let lo = earliest;
  let hi = tip;
  while (lo < hi) {
    const mid = (lo + hi) / BigInt(2);
    if ((await blockTimeMsAtHeight(mid)) < targetMs) lo = mid + BigInt(1);
    else hi = mid;
  }
  return lo;
}

async function getCursor(): Promise<bigint> {
  const rows = await db.select().from(indexerState).where(eq(indexerState.id, "singleton")).limit(1);
  return rows[0]?.lastIndexedHeight ?? BigInt(0);
}

async function fetchBlockPair(height: bigint): Promise<{ block: RpcBlockResponse; results: RpcBlockResultsResponse }> {
  const hStr = height.toString();
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RPC_RETRIES; attempt++) {
    try {
      const [block, results] = await Promise.all([
        rpcCallWithFallback<RpcBlockResponse>(RPC_URLS, "block", { height: hStr }),
        rpcCallWithFallback<RpcBlockResultsResponse>(RPC_URLS, "block_results", { height: hStr }),
      ]);
      return { block, results };
    } catch (e) {
      lastErr = e;
      const backoff = Math.min(30_000, 400 * 2 ** (attempt - 1));
      console.warn(`${TAG} RPC height ${hStr} attempt ${attempt}/${RPC_RETRIES} failed; retry in ${backoff}ms`);
      if (attempt < RPC_RETRIES) await sleep(backoff);
    }
  }
  throw lastErr;
}

async function deleteExistingOutcomeCategoryRows() {
  for (const s of REBUILT_SERIES) {
    await db.delete(dailyMetrics).where(eq(dailyMetrics.series, s));
    await db.delete(hourlyMetrics).where(eq(hourlyMetrics.series, s));
  }
  await db.delete(offerCategoryParticipantDay);
  console.error(`${TAG} FULL mode: deleted ${REBUILT_SERIES.join(", ")} rows (daily + hourly) and all offer_category_participant_day rows`);
}

async function persist(daily: Map<string, bigint>, hourly: Map<string, bigint>, triples: Set<string>) {
  await db.transaction(async (tx) => {
    for (const [key, delta] of daily) {
      if (delta === BigInt(0)) continue;
      const [day, series, dimension] = key.split(ROLLUP_KEY_DELIM);
      if (!(REBUILT_SERIES as readonly string[]).includes(series!)) continue;
      if (BACKFILL_SKIP_DELETE && series === SERIES.OFFER_CATEGORY) continue; // resume mode never touches the intent series
      await tx
        .insert(dailyMetrics)
        .values({ day, series, dimension, value: delta.toString() })
        .onConflictDoUpdate({
          target: [dailyMetrics.day, dailyMetrics.series, dailyMetrics.dimension],
          set: { value: sql`${dailyMetrics.value} + ${sql.raw("excluded.value")}` },
        });
    }
    for (const [key, delta] of hourly) {
      if (delta === BigInt(0)) continue;
      const [iso, series, dimension] = key.split(ROLLUP_KEY_DELIM);
      if (!(REBUILT_SERIES as readonly string[]).includes(series!)) continue;
      if (BACKFILL_SKIP_DELETE && series === SERIES.OFFER_CATEGORY) continue;
      await tx
        .insert(hourlyMetrics)
        .values({ hour: new Date(iso), series, dimension, value: delta.toString() })
        .onConflictDoUpdate({
          target: [hourlyMetrics.hour, hourlyMetrics.series, hourlyMetrics.dimension],
          set: { value: sql`${hourlyMetrics.value} + ${sql.raw("excluded.value")}` },
        });
    }
    for (const key of triples) {
      const [day, address, category] = key.split(ROLLUP_KEY_DELIM);
      await tx.insert(offerCategoryParticipantDay).values({ day, address, category }).onConflictDoNothing();
    }
  });
}

function minBigint(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

async function main() {
  await ensureOfferCategoryParticipantDayTable(db);
  const tip = await latestHeight();
  const cursor = await getCursor();
  if (cursor === BigInt(0)) {
    console.error(`${TAG} indexer_state cursor is 0 — run the indexer first.`);
    process.exit(1);
  }
  const fromH = process.env.BACKFILL_FROM_HEIGHT ? BigInt(process.env.BACKFILL_FROM_HEIGHT) : await findStartHeightByTime(START_DATE_MS, tip);
  const toH = process.env.BACKFILL_TO_HEIGHT ? BigInt(process.env.BACKFILL_TO_HEIGHT) : cursor;
  if (fromH > toH) {
    console.error(`${TAG} fromHeight ${fromH} > toHeight ${toH}, nothing to do.`);
    process.exit(0);
  }
  console.error(
    `${TAG} heights ${fromH}..${toH} (${(toH - fromH + BigInt(1)).toString()} blocks) batch=${BATCH} concurrency=${CONCURRENCY} skipDelete=${BACKFILL_SKIP_DELETE}`
  );
  if (process.env.BACKFILL_FROM_HEIGHT && !BACKFILL_SKIP_DELETE) {
    console.error(`${TAG} WARNING: BACKFILL_FROM_HEIGHT set without BACKFILL_SKIP_DELETE=1 — the startup DELETE wipes ALL ${SERIES.OFFER_OUTCOME_CATEGORY} rows.`);
  }
  if (BACKFILL_SKIP_DELETE) console.error(`${TAG} BACKFILL_SKIP_DELETE set — upserting on top of existing rows.`);
  else await deleteExistingOutcomeCategoryRows();

  let h = fromH;
  let done = BigInt(0);
  const span = toH - fromH + BigInt(1);
  const t0 = Date.now();
  while (h <= toH) {
    const batchEnd = h + minBigint(toH - h + BigInt(1), BigInt(BATCH)) - BigInt(1);
    const daily = new Map<string, bigint>();
    const hourly = new Map<string, bigint>();
    const triples = new Set<string>();
    let x = h;
    while (x <= batchEnd) {
      const n = Number(minBigint(batchEnd - x + BigInt(1), BigInt(CONCURRENCY)));
      const heights = Array.from({ length: n }, (_, i) => x + BigInt(i));
      const pairs = await Promise.all(heights.map(fetchBlockPair));
      for (const p of pairs) accumulateOfferCategoriesFromBlock(p.block, p.results, daily, hourly, triples);
      x += BigInt(n);
    }
    await persist(daily, hourly, triples);
    done += batchEnd - h + BigInt(1);
    const pct = Number((done * BigInt(1000)) / span) / 10;
    console.error(`${TAG} ${done}/${span} blocks (${pct}%) through height ${batchEnd} — ${triples.size} category-participant rows, ${daily.size} outcome-category day keys; ${Math.round((Date.now() - t0) / 1000)}s`);
    h = batchEnd + BigInt(1);
  }
  await pool.end();
  console.error(`${TAG} done`);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
