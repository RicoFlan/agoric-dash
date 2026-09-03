/**
 * Backfill the EndBlock-sourced outputs the indexer only produces from its deploy height onward:
 *   --ibc-orch   ibc_transfer_amount_out_orch / ibc_transfer_out_count_orch (daily + hourly metrics)
 *   --ymax       ymax_portfolio / ymax_position / ymax_flow latest-state upserts
 * Both by default. Replays block_results only (no tx decode) with a worker pool, from
 * INDEXER_START_DATE (or BACKFILL_FROM_HEIGHT) through the indexer cursor (or BACKFILL_TO_HEIGHT).
 *
 * Idempotency:
 *   - YMax upserts are latest-wins by height: always safe to re-run.
 *   - the orch-IBC series are additive on upsert, so by default the script DELETES every existing row
 *     of those two series first (both tables) and rebuilds; BACKFILL_SKIP_DELETE=1 + BACKFILL_FROM_HEIGHT
 *     resumes a partial run without double counting.
 * Never touches any other series or table; never runs reindex:reset.
 *
 * Env: DATABASE_URL, RPC_URL[, RPC_URL_FALLBACK], INDEXER_START_DATE, BACKFILL_FROM_HEIGHT,
 *      BACKFILL_TO_HEIGHT, BACKFILL_SKIP_DELETE, BACKFILL_BATCH (1000), BACKFILL_CONCURRENCY (16),
 *      INDEXER_RPC_RETRIES (8)
 * Run: npm run backfill:endblock -- [--ibc-orch] [--ymax]
 */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../src/db/schema";
import { ensureYmaxTables } from "../src/db/ensureAdditiveTables";
import { endBlockIbcSends } from "../src/lib/endBlockIbc";
import { rpcCallWithFallback, type RpcBlockResponse, type RpcBlockResultsResponse } from "../src/lib/rpc";
import { SERIES } from "../src/lib/semantics";
import { accumulateYmaxFromBlock, persistYmax, YmaxAccumulator } from "../src/lib/ymaxRollup";

const TAG = "[backfillEndBlock]";
const args = new Set(process.argv.slice(2));
const DO_IBC = args.size === 0 || args.has("--ibc-orch");
const DO_YMAX = args.size === 0 || args.has("--ymax");
const DATABASE_URL = process.env.DATABASE_URL;
const RPC_URL_PRIMARY = process.env.RPC_URL ?? "https://main-a.rpc.agoric.net";
const RPC_URL_FALLBACK = process.env.RPC_URL_FALLBACK ?? "";
const RPC_URLS: readonly string[] = [RPC_URL_PRIMARY, RPC_URL_FALLBACK];
const START_DATE_ISO = process.env.INDEXER_START_DATE ?? "2026-01-01T00:00:00Z";
const START_DATE_MS = new Date(START_DATE_ISO).getTime();
const BATCH = Math.max(1, Number(process.env.BACKFILL_BATCH ?? "1000"));
const CONCURRENCY = Math.max(1, Math.min(64, Number(process.env.BACKFILL_CONCURRENCY ?? "16")));
const RPC_RETRIES = Math.max(1, Number(process.env.INDEXER_RPC_RETRIES ?? "8"));
const SKIP_DELETE = ["1", "true", "yes"].includes((process.env.BACKFILL_SKIP_DELETE ?? "").trim().toLowerCase());
const ROLLUP_KEY_DELIM = "\0";

if (!DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema });
const { dailyMetrics, hourlyMetrics, indexerState } = schema;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

async function latestHeight(): Promise<bigint> {
  const st = await rpcCallWithFallback<{ sync_info: { latest_block_height: string } }>(RPC_URLS, "status", {});
  return BigInt(st.sync_info.latest_block_height);
}
async function blockTimeMs(height: bigint): Promise<number> {
  const b = await rpcCallWithFallback<RpcBlockResponse>(RPC_URLS, "block", { height: height.toString() });
  const ms = new Date(b.block.header.time).getTime();
  if (!Number.isFinite(ms)) throw new Error(`Invalid block time at ${height}`);
  return ms;
}
async function findEarliestQueryable(tip: bigint): Promise<bigint> {
  let lo = BigInt(1);
  let hi = tip;
  while (lo < hi) {
    const mid = (lo + hi) / BigInt(2);
    if (await blockTimeMs(mid).then(() => true, () => false)) hi = mid;
    else lo = mid + BigInt(1);
  }
  return lo;
}
async function findStartHeight(targetMs: number, tip: bigint): Promise<bigint> {
  const earliest = await findEarliestQueryable(tip);
  if (targetMs <= (await blockTimeMs(earliest))) return earliest;
  if (targetMs > (await blockTimeMs(tip))) return tip + BigInt(1);
  let lo = earliest;
  let hi = tip;
  while (lo < hi) {
    const mid = (lo + hi) / BigInt(2);
    if ((await blockTimeMs(mid)) < targetMs) lo = mid + BigInt(1);
    else hi = mid;
  }
  return lo;
}
async function getCursor(): Promise<bigint> {
  const rows = await db.select().from(indexerState).where(eq(indexerState.id, "singleton")).limit(1);
  return rows[0]?.lastIndexedHeight ?? BigInt(0);
}

/** block_results only; the block header time comes from the results' height via a cheap header fetch cache. */
async function fetchResults(height: bigint): Promise<{ results: RpcBlockResultsResponse; timeIso: string }> {
  const hStr = height.toString();
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RPC_RETRIES; attempt++) {
    try {
      const [results, block] = await Promise.all([
        rpcCallWithFallback<RpcBlockResultsResponse>(RPC_URLS, "block_results", { height: hStr }),
        rpcCallWithFallback<{ block: { header: { time: string } } }>(RPC_URLS, "block", { height: hStr }),
      ]);
      if (!results || typeof results !== "object" || !block?.block?.header?.time) throw new Error(`empty response at ${hStr} (pruned node?)`);
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

function bump(m: Map<string, bigint>, key: string, delta: bigint) {
  m.set(key, (m.get(key) ?? BigInt(0)) + delta);
}
function hourIso(iso: string): string {
  const d = new Date(iso);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

async function persistMetrics(daily: Map<string, bigint>, hourly: Map<string, bigint>) {
  await db.transaction(async (tx) => {
    for (const [key, delta] of daily) {
      if (delta === BigInt(0)) continue;
      const [day, series, dimension] = key.split(ROLLUP_KEY_DELIM);
      await tx
        .insert(dailyMetrics)
        .values({ day, series, dimension, value: delta.toString() })
        .onConflictDoUpdate({ target: [dailyMetrics.day, dailyMetrics.series, dailyMetrics.dimension], set: { value: sql`${dailyMetrics.value} + ${sql.raw("excluded.value")}` } });
    }
    for (const [key, delta] of hourly) {
      if (delta === BigInt(0)) continue;
      const [iso, series, dimension] = key.split(ROLLUP_KEY_DELIM);
      await tx
        .insert(hourlyMetrics)
        .values({ hour: new Date(iso), series, dimension, value: delta.toString() })
        .onConflictDoUpdate({ target: [hourlyMetrics.hour, hourlyMetrics.series, hourlyMetrics.dimension], set: { value: sql`${hourlyMetrics.value} + ${sql.raw("excluded.value")}` } });
    }
  });
}

async function main() {
  if (DO_YMAX) await ensureYmaxTables(db);
  const tip = await latestHeight();
  const cursor = await getCursor();
  if (cursor === BigInt(0)) {
    console.error(`${TAG} indexer_state cursor is 0 — run the indexer first.`);
    process.exit(1);
  }
  const fromH = process.env.BACKFILL_FROM_HEIGHT ? BigInt(process.env.BACKFILL_FROM_HEIGHT) : await findStartHeight(START_DATE_MS, tip);
  const toH = process.env.BACKFILL_TO_HEIGHT ? BigInt(process.env.BACKFILL_TO_HEIGHT) : cursor;
  if (fromH > toH) {
    console.error(`${TAG} fromHeight ${fromH} > toHeight ${toH}, nothing to do.`);
    process.exit(0);
  }
  console.error(`${TAG} heights ${fromH}..${toH} (${(toH - fromH + BigInt(1)).toString()} blocks) ibcOrch=${DO_IBC} ymax=${DO_YMAX} batch=${BATCH} concurrency=${CONCURRENCY} skipDelete=${SKIP_DELETE}`);
  if (DO_IBC) {
    if (SKIP_DELETE) console.error(`${TAG} BACKFILL_SKIP_DELETE set — upserting orch-IBC series on top of existing rows.`);
    else {
      for (const s of [SERIES.IBC_TRANSFER_AMOUNT_OUT_ORCH, SERIES.IBC_TRANSFER_OUT_COUNT_ORCH]) {
        await db.delete(dailyMetrics).where(eq(dailyMetrics.series, s));
        await db.delete(hourlyMetrics).where(eq(hourlyMetrics.series, s));
      }
      console.error(`${TAG} deleted existing orch-IBC series rows`);
    }
  }

  let h = fromH;
  let done = BigInt(0);
  const span = toH - fromH + BigInt(1);
  const t0 = Date.now();
  while (h <= toH) {
    const batchEnd = h + (toH - h + BigInt(1) < BigInt(BATCH) ? toH - h + BigInt(1) : BigInt(BATCH)) - BigInt(1);
    const daily = new Map<string, bigint>();
    const hourly = new Map<string, bigint>();
    const ymax = new YmaxAccumulator();
    let sends = 0;
    let nextH = h;
    const worker = async () => {
      for (;;) {
        if (nextH > batchEnd) return;
        const ht = nextH;
        nextH += BigInt(1);
        const { results, timeIso } = await fetchResults(ht);
        if (DO_IBC) {
          const day = timeIso.slice(0, 10);
          const hr = hourIso(timeIso);
          for (const s of endBlockIbcSends(results.finalize_block_events ?? results.end_block_events)) {
            sends += 1;
            bump(daily, [day, SERIES.IBC_TRANSFER_AMOUNT_OUT_ORCH, s.denom].join(ROLLUP_KEY_DELIM), s.amount);
            bump(hourly, [hr, SERIES.IBC_TRANSFER_AMOUNT_OUT_ORCH, s.denom].join(ROLLUP_KEY_DELIM), s.amount);
            bump(daily, [day, SERIES.IBC_TRANSFER_OUT_COUNT_ORCH, ""].join(ROLLUP_KEY_DELIM), BigInt(1));
            bump(hourly, [hr, SERIES.IBC_TRANSFER_OUT_COUNT_ORCH, ""].join(ROLLUP_KEY_DELIM), BigInt(1));
          }
        }
        if (DO_YMAX) accumulateYmaxFromBlock(results, ht, timeIso, ymax);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (DO_IBC) await persistMetrics(daily, hourly);
    if (DO_YMAX) await persistYmax(db, ymax);
    done += batchEnd - h + BigInt(1);
    const pct = Number((done * BigInt(1000)) / span) / 10;
    console.error(`${TAG} ${done}/${span} blocks (${pct}%) through ${batchEnd} — ${sends} orch sends, ymax rows ${ymax.size}; ${Math.round((Date.now() - t0) / 1000)}s`);
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
