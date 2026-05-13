/**
 * One-time (or repeatable) backfill: delete all `bank_credits_volume` rows, then replay blocks
 * from INDEXER_START_DATE through indexer cursor height and **only** upsert that series in
 * daily_metrics + hourly_metrics. Does **not** update indexer_state or any other series.
 *
 * Source: `coin_received` events on successful txs, per-denom sum of amounts whose `receiver`
 * is not in `AGORIC_MODULE_ACCOUNT_ADDRESSES`. See `bankCreditsRollup.ts`.
 *
 * Idempotency: by default the script deletes **all existing** rows for `bank_credits_volume` from
 * daily_metrics and hourly_metrics, then replays (same as `backfillIbcTransferFlowIn.ts`). Set
 * `BACKFILL_SKIP_DELETE=1` to skip the DELETE and only upsert — use with `BACKFILL_FROM_HEIGHT` after
 * a partial run so earlier committed rows are not wiped.
 *
 * Usage:
 *   DATABASE_URL=... RPC_URL=... npx tsx scripts/backfillBankCreditsVolume.ts
 *
 * Optional:
 *   BACKFILL_FROM_HEIGHT — decimal height (skip time lookup)
 *   BACKFILL_TO_HEIGHT — decimal height inclusive end (default: indexer_state.last_indexed_height)
 *   BACKFILL_BATCH — max blocks per DB commit (default 2000)
 *   BACKFILL_CONCURRENCY — parallel block fetches per batch (default 12)
 *   BACKFILL_SKIP_DELETE — when set to 1/true/yes, skip the startup DELETE and only upsert (use with
 *     BACKFILL_FROM_HEIGHT after a partial run so earlier committed rows are not wiped)
 *   INDEXER_START_DATE — same as indexer (default 2026-01-01T00:00:00Z)
 *   INDEXER_RPC_RETRIES — same as indexer (default 6)
 */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../src/db/schema";
import { accumulateBankCreditsFromBlock } from "../src/lib/bankCreditsRollup";
import { isAgoricModuleAccount } from "../src/lib/agoricModuleAccounts";
import { rpcCallWithFallback, type RpcBlockResponse, type RpcBlockResultsResponse } from "../src/lib/rpc";
import { SERIES } from "../src/lib/semantics";

const DATABASE_URL = process.env.DATABASE_URL;
/**
 * Primary CometBFT RPC. Defaults to the canonical Agoric mainnet RPC when unset.
 * `RPC_URL_FALLBACK` is opt-in; when set, each call tries primary first and
 * fails over per-call (no sticky state) — see {@link rpcCallWithFallback}.
 */
const RPC_URL_PRIMARY = process.env.RPC_URL ?? "https://main-a.rpc.agoric.net";
const RPC_URL_FALLBACK = process.env.RPC_URL_FALLBACK ?? "";
const RPC_URLS: readonly string[] = [RPC_URL_PRIMARY, RPC_URL_FALLBACK];
const START_DATE_ISO = process.env.INDEXER_START_DATE ?? "2026-01-01T00:00:00Z";
const START_DATE_MS = new Date(START_DATE_ISO).getTime();
const ROLLUP_KEY_DELIM = "\0";
const BATCH = Math.max(1, Number(process.env.BACKFILL_BATCH ?? "2000"));
const CONCURRENCY = Math.max(1, Math.min(128, Number(process.env.BACKFILL_CONCURRENCY ?? "12")));
const RPC_RETRIES = Math.max(1, Number(process.env.INDEXER_RPC_RETRIES ?? "6"));

function readBackfillSkipDelete(): boolean {
  const v = (process.env.BACKFILL_SKIP_DELETE ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

const BACKFILL_SKIP_DELETE = readBackfillSkipDelete();

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
const { dailyMetrics, hourlyMetrics, indexerState } = schema;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

async function latestHeight(): Promise<bigint> {
  const st = await rpcCallWithFallback<{ sync_info: { latest_block_height: string } }>(
    RPC_URLS,
    "status",
    {}
  );
  return BigInt(st.sync_info.latest_block_height);
}

async function blockTimeMsAtHeight(height: bigint): Promise<number> {
  const block = await rpcCallWithFallback<RpcBlockResponse>(RPC_URLS, "block", {
    height: height.toString(),
  });
  const ms = new Date(block.block.header.time).getTime();
  if (!Number.isFinite(ms)) throw new Error(`Invalid block time at height ${height.toString()}`);
  return ms;
}

async function blockTimeMsAtHeightOrNull(height: bigint): Promise<number | null> {
  try {
    return await blockTimeMsAtHeight(height);
  } catch {
    return null;
  }
}

async function findEarliestQueryableHeight(tip: bigint): Promise<bigint> {
  let lo = BigInt(1);
  let hi = tip;
  while (lo < hi) {
    const mid = (lo + hi) / BigInt(2);
    const ok = (await blockTimeMsAtHeightOrNull(mid)) !== null;
    if (ok) hi = mid;
    else lo = mid + BigInt(1);
  }
  return lo;
}

async function findStartHeightByTime(targetMs: number, tip: bigint): Promise<bigint> {
  const earliestQueryable = await findEarliestQueryableHeight(tip);
  const earliestQueryableMs = await blockTimeMsAtHeight(earliestQueryable);
  if (targetMs <= earliestQueryableMs) return earliestQueryable;

  const tipMs = await blockTimeMsAtHeight(tip);
  if (targetMs > tipMs) return tip + BigInt(1);

  let lo = earliestQueryable;
  let hi = tip;
  while (lo < hi) {
    const mid = (lo + hi) / BigInt(2);
    const midMs = await blockTimeMsAtHeight(mid);
    if (midMs < targetMs) lo = mid + BigInt(1);
    else hi = mid;
  }
  return lo;
}

async function getCursor(): Promise<bigint> {
  const rows = await db.select().from(indexerState).where(eq(indexerState.id, "singleton")).limit(1);
  return rows[0]?.lastIndexedHeight ?? BigInt(0);
}

async function fetchBlockPair(height: bigint): Promise<{
  block: RpcBlockResponse;
  results: RpcBlockResultsResponse;
}> {
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
      console.warn(
        `RPC height ${hStr} attempt ${attempt}/${RPC_RETRIES} failed: ${e instanceof Error ? e.message : String(e)}; retry in ${backoff}ms`
      );
      if (attempt < RPC_RETRIES) await sleep(backoff);
    }
  }
  throw lastErr;
}

async function deleteExistingBankCreditsRows() {
  await db.delete(dailyMetrics).where(eq(dailyMetrics.series, SERIES.BANK_CREDITS_VOLUME));
  await db.delete(hourlyMetrics).where(eq(hourlyMetrics.series, SERIES.BANK_CREDITS_VOLUME));
  console.error(
    `[backfillBankCreditsVolume] deleted existing ${SERIES.BANK_CREDITS_VOLUME} from daily_metrics and hourly_metrics`
  );
}

async function persistBankCreditsMaps(daily: Map<string, bigint>, hourly: Map<string, bigint>) {
  await db.transaction(async (tx) => {
    for (const [key, delta] of daily) {
      if (delta === BigInt(0)) continue;
      const [day, series, dimension] = key.split(ROLLUP_KEY_DELIM);
      if (series !== SERIES.BANK_CREDITS_VOLUME) continue;
      const dStr = delta.toString();
      await tx
        .insert(dailyMetrics)
        .values({ day, series, dimension, value: dStr })
        .onConflictDoUpdate({
          target: [dailyMetrics.day, dailyMetrics.series, dailyMetrics.dimension],
          set: { value: sql`${dailyMetrics.value} + ${sql.raw("excluded.value")}` },
        });
    }
    for (const [key, delta] of hourly) {
      if (delta === BigInt(0)) continue;
      const [iso, series, dimension] = key.split(ROLLUP_KEY_DELIM);
      if (series !== SERIES.BANK_CREDITS_VOLUME) continue;
      const hour = new Date(iso);
      const dStr = delta.toString();
      await tx
        .insert(hourlyMetrics)
        .values({ hour, series, dimension, value: dStr })
        .onConflictDoUpdate({
          target: [hourlyMetrics.hour, hourlyMetrics.series, hourlyMetrics.dimension],
          set: { value: sql`${hourlyMetrics.value} + ${sql.raw("excluded.value")}` },
        });
    }
  });
}

function minBigint(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

async function main() {
  const tip = await latestHeight();
  const cursor = await getCursor();
  if (cursor === BigInt(0)) {
    console.error("[backfillBankCreditsVolume] indexer_state cursor is 0 — run the indexer first.");
    process.exit(1);
  }

  let fromH: bigint;
  if (process.env.BACKFILL_FROM_HEIGHT) {
    fromH = BigInt(process.env.BACKFILL_FROM_HEIGHT);
  } else {
    fromH = await findStartHeightByTime(START_DATE_MS, tip);
  }

  let toH: bigint;
  if (process.env.BACKFILL_TO_HEIGHT) {
    toH = BigInt(process.env.BACKFILL_TO_HEIGHT);
  } else {
    toH = cursor;
  }

  if (fromH > toH) {
    console.error(`[backfillBankCreditsVolume] fromHeight ${fromH} > toHeight ${toH}, nothing to do.`);
    process.exit(0);
  }

  console.error(
    `[backfillBankCreditsVolume] RPC primary=${RPC_URL_PRIMARY} fallback=${RPC_URL_FALLBACK || "<none>"} heights ${fromH}..${toH} (${(toH - fromH + BigInt(1)).toString()} blocks) batch=${BATCH} concurrency=${CONCURRENCY} skipDelete=${BACKFILL_SKIP_DELETE}`
  );
  if (process.env.BACKFILL_FROM_HEIGHT && !BACKFILL_SKIP_DELETE) {
    console.error(
      `[backfillBankCreditsVolume] WARNING: BACKFILL_FROM_HEIGHT is set but the default startup DELETE still wipes ALL existing ${SERIES.BANK_CREDITS_VOLUME} rows. Set BACKFILL_SKIP_DELETE=1 to resume from a height without losing prior commits.`
    );
  }
  if (BACKFILL_SKIP_DELETE) {
    console.error(
      "[backfillBankCreditsVolume] BACKFILL_SKIP_DELETE is set — skipping DELETE; replay will upsert on top of existing rows."
    );
  } else {
    console.error("[backfillBankCreditsVolume] deleting existing bank_credits_volume metrics…");
    await deleteExistingBankCreditsRows();
  }

  let h = fromH;
  let done = BigInt(0);
  const span = toH - fromH + BigInt(1);

  while (h <= toH) {
    const room = toH - h + BigInt(1);
    const batchBlocks = minBigint(room, BigInt(BATCH));
    const batchEnd = h + batchBlocks - BigInt(1);

    const daily = new Map<string, bigint>();
    const hourly = new Map<string, bigint>();
    let x = h;
    while (x <= batchEnd) {
      const innerRoom = batchEnd - x + BigInt(1);
      const n = minBigint(innerRoom, BigInt(CONCURRENCY));
      const nNum = Number(n);
      const heights: bigint[] = [];
      for (let i = 0; i < nNum; i++) heights.push(x + BigInt(i));
      const pairs = await Promise.all(heights.map((ht) => fetchBlockPair(ht)));
      for (const p of pairs) {
        accumulateBankCreditsFromBlock(p.block, p.results, daily, hourly, isAgoricModuleAccount);
      }
      x += n;
    }

    await persistBankCreditsMaps(daily, hourly);
    done += batchBlocks;
    console.error(
      `[backfillBankCreditsVolume] committed through height ${batchEnd.toString()} (${done.toString()} / ${span.toString()} blocks)…`
    );
    h = batchEnd + BigInt(1);
  }

  console.error("[backfillBankCreditsVolume] done.");
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
