/**
 * Operational checks: (1) hourly_metrics sums vs daily_metrics per UTC day; (2) optional RPC replay
 * of `ibc_transfer_flow_in` for that day vs DB (same rollup as indexer / backfill — see
 * `ibcTransferFlowInRollup.ts`).
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/verifyRollupParity.ts --day=2026-04-01
 *
 * Optional replay (requires RPC; respects indexer cursor so pruned RPC + indexed height align):
 *   DATABASE_URL=... RPC_URL=... npx tsx scripts/verifyRollupParity.ts --day=2026-04-01 --replay-ibc-flow-in
 *   … --replay-offer-categories   (P2: offer_outcome_category daily totals + distinct
 *                                  offer_category_participant_day rows for that day vs RPC replay)
 *
 * Env: PARITY_RPC_CONCURRENCY (default 12) — parallel block fetches for replay.
 */
import "dotenv/config";
import { and, eq, gte, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../src/db/schema";
import { accumulateIbcTransferFlowInFromBlock } from "../src/lib/ibcTransferFlowInRollup";
import { accumulateOfferCategoriesFromBlock, ROLLUP_KEY_DELIM as OFFER_KEY_DELIM } from "../src/lib/offerCategoryRollup";
import {
  compareHourlyDailyParity,
  type DailyMetricRow,
  type HourlyMetricRow,
  utcDayMillisBounds,
} from "../src/lib/metricsRollupParity";
import {
  rpcCallWithFallback,
  type RpcBlockResponse,
  type RpcBlockResultsResponse,
} from "../src/lib/rpc";
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

const pool = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL }) : null;
const db = pool ? drizzle(pool, { schema }) : null;

function parseArgs(argv: string[]) {
  let day = "";
  let replay = false;
  let replayOfferCategories = false;
  for (const a of argv) {
    if (a.startsWith("--day=")) day = a.slice("--day=".length);
    else if (a === "--replay-ibc-flow-in") replay = true;
    else if (a === "--replay-offer-categories") replayOfferCategories = true;
  }
  return { day, replay, replayOfferCategories };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function rpcCallRetry<T>(rpcUrls: readonly string[], method: string, params: unknown): Promise<T> {
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

async function blockTimeMsAtHeightOrNull(
  rpcUrls: readonly string[],
  height: bigint
): Promise<number | null> {
  try {
    const block = await rpcCallRetry<RpcBlockResponse>(rpcUrls, "block", { height: height.toString() });
    const t = block.block?.header?.time;
    if (!t) return null;
    const ms = new Date(t).getTime();
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
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

async function replayIbcFlowInForDay(
  rpcUrls: readonly string[],
  dayUtc: string,
  maxHeightInclusive: bigint
): Promise<bigint> {
  const { startMs, endMs } = utcDayMillisBounds(dayUtc);
  const tip = await latestHeight(rpcUrls);
  const tipBound = tip < maxHeightInclusive ? tip : maxHeightInclusive;

  const hStart = await findHeightAtOrAfterTime(rpcUrls, startMs, tipBound);
  const hEndExclusive = await findHeightAtOrAfterTime(rpcUrls, endMs, tipBound);

  if (hStart > tipBound || hStart >= hEndExclusive) {
    console.warn(
      `[verifyRollupParity] no blocks in range for ${dayUtc} (pruned RPC or empty day?)`
    );
    return BigInt(0);
  }

  const endBlock = hEndExclusive > BigInt(0) ? hEndExclusive - BigInt(1) : BigInt(0);
  const last = endBlock < tipBound ? endBlock : tipBound;

  const daily = new Map<string, bigint>();
  const hourly = new Map<string, bigint>();
  const concurrency = Math.max(1, Math.min(64, Number(process.env.PARITY_RPC_CONCURRENCY ?? "12")));

  let cursor = hStart;
  while (cursor <= last) {
    const batch: bigint[] = [];
    for (let i = 0; i < concurrency && cursor <= last; i++, cursor++) {
      batch.push(cursor);
    }
    const pairs = await Promise.all(batch.map((h) => fetchBlockPair(rpcUrls, h)));
    for (const { block, results } of pairs) {
      accumulateIbcTransferFlowInFromBlock(block, results, daily, hourly);
    }
  }

  const ROLLUP_KEY_DELIM = "\0";
  const key = [dayUtc, SERIES.IBC_TRANSFER_FLOW_IN, ""].join(ROLLUP_KEY_DELIM);
  return daily.get(key) ?? BigInt(0);
}

/** Replay one UTC day for the P2 outputs: outcome-category daily totals and distinct category-participant triples. */
async function replayOfferCategoriesForDay(
  rpcUrls: readonly string[],
  dayUtc: string,
  maxHeightInclusive: bigint
): Promise<{ outcomeDims: Map<string, bigint>; participantTriples: Set<string> }> {
  const { startMs, endMs } = utcDayMillisBounds(dayUtc);
  const tip = await latestHeight(rpcUrls);
  const tipBound = tip < maxHeightInclusive ? tip : maxHeightInclusive;
  const hStart = await findHeightAtOrAfterTime(rpcUrls, startMs, tipBound);
  const hEndExclusive = await findHeightAtOrAfterTime(rpcUrls, endMs, tipBound);
  const outcomeDims = new Map<string, bigint>();
  const participantTriples = new Set<string>();
  if (hStart > tipBound || hStart >= hEndExclusive) return { outcomeDims, participantTriples };
  const last = (hEndExclusive - BigInt(1)) < tipBound ? hEndExclusive - BigInt(1) : tipBound;
  const daily = new Map<string, bigint>();
  const hourly = new Map<string, bigint>();
  const concurrency = Math.max(1, Math.min(64, Number(process.env.PARITY_RPC_CONCURRENCY ?? "12")));
  let cursor = hStart;
  while (cursor <= last) {
    const batch: bigint[] = [];
    for (let i = 0; i < concurrency && cursor <= last; i++, cursor++) batch.push(cursor);
    const pairs = await Promise.all(batch.map((h) => fetchBlockPair(rpcUrls, h)));
    for (const { block, results } of pairs) accumulateOfferCategoriesFromBlock(block, results, daily, hourly, participantTriples);
  }
  for (const [key, v] of daily) {
    const [d, series, dim] = key.split(OFFER_KEY_DELIM);
    if (d === dayUtc && series === SERIES.OFFER_OUTCOME_CATEGORY) outcomeDims.set(dim!, v);
  }
  return { outcomeDims, participantTriples };
}

async function main() {
  const { day, replay, replayOfferCategories } = parseArgs(process.argv.slice(2));
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    console.error("Usage: DATABASE_URL=... npx tsx scripts/verifyRollupParity.ts --day=YYYY-MM-DD [--replay-ibc-flow-in]");
    process.exit(1);
  }
  if (!db || !pool) {
    console.error("DATABASE_URL required");
    process.exit(1);
  }

  try {
  const { startMs, endMs } = utcDayMillisBounds(day);
  const dayStart = new Date(startMs);
  const dayEnd = new Date(endMs);

  const dailyRowsRaw = await db
    .select()
    .from(schema.dailyMetrics)
    .where(eq(schema.dailyMetrics.day, day));

  const hourlyRowsRaw = await db
    .select()
    .from(schema.hourlyMetrics)
    .where(and(gte(schema.hourlyMetrics.hour, dayStart), lt(schema.hourlyMetrics.hour, dayEnd)));

  const daily: DailyMetricRow[] = dailyRowsRaw.map((r) => ({
    day: r.day,
    series: r.series,
    dimension: r.dimension,
    value: r.value,
  }));
  const hourly: HourlyMetricRow[] = hourlyRowsRaw.map((r) => ({
    hour: r.hour,
    series: r.series,
    dimension: r.dimension,
    value: r.value,
  }));

  const parity = compareHourlyDailyParity(daily, hourly, day);
  if (!parity.ok) {
    console.error(`[verifyRollupParity] hourly vs daily mismatch for ${day} (${parity.mismatches.length} keys)`);
    for (const m of parity.mismatches) {
      console.error(
        `  series=${m.series} dimension=${JSON.stringify(m.dimension)} daily=${m.dailyValue} hourlySum=${m.hourlySum}`
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log(`[verifyRollupParity] OK hourly vs daily parity for ${day} (${hourly.length} hourly rows)`);

  if (replay) {
    const st = await db.select().from(schema.indexerState).where(eq(schema.indexerState.id, "singleton")).limit(1);
    const cursorStr = st[0]?.lastIndexedHeight?.toString();
    if (!cursorStr) {
      console.error("[verifyRollupParity] indexer_state missing — cannot bound replay");
      process.exitCode = 1;
      return;
    }
    const cursorH = BigInt(cursorStr);
    const replayed = await replayIbcFlowInForDay(RPC_URLS, day, cursorH);

    const dbFlow = daily.find((r) => r.series === SERIES.IBC_TRANSFER_FLOW_IN && r.dimension === "");
    const dbVal = dbFlow ? BigInt(dbFlow.value || "0") : BigInt(0);
    if (replayed !== dbVal) {
      console.error(
        `[verifyRollupParity] ibc_transfer_flow_in replay ${replayed.toString()} !== daily_metrics ${dbVal.toString()} (indexed through height ${cursorStr})`
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `[verifyRollupParity] OK ibc_transfer_flow_in RPC replay matches daily total (${replayed.toString()})`
    );
  }

  if (replayOfferCategories) {
    const st = await db.select().from(schema.indexerState).where(eq(schema.indexerState.id, "singleton")).limit(1);
    const cursorStr = st[0]?.lastIndexedHeight?.toString();
    if (!cursorStr) {
      console.error("[verifyRollupParity] indexer_state missing — cannot bound replay");
      process.exitCode = 1;
      return;
    }
    const { outcomeDims, participantTriples } = await replayOfferCategoriesForDay(RPC_URLS, day, BigInt(cursorStr));
    // outcome-category: every dimension in either side must agree
    const dbDims = new Map<string, bigint>();
    for (const r of daily) if (r.series === SERIES.OFFER_OUTCOME_CATEGORY) dbDims.set(r.dimension, BigInt(r.value || "0"));
    const dims = new Set([...outcomeDims.keys(), ...dbDims.keys()]);
    let bad = 0;
    for (const dim of dims) {
      const a = outcomeDims.get(dim) ?? BigInt(0);
      const b = dbDims.get(dim) ?? BigInt(0);
      if (a !== b) {
        bad += 1;
        console.error(`[verifyRollupParity] offer_outcome_category ${JSON.stringify(dim)} replay=${a} db=${b}`);
      }
    }
    // category participants: distinct (address, category) rows for the day
    const rows = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM offer_category_participant_day WHERE day = $1::date`,
      [day]
    );
    const dbTriples = Number(rows.rows[0]?.c ?? 0);
    const replayTriples = [...participantTriples].filter((k) => k.startsWith(day + OFFER_KEY_DELIM)).length;
    if (dbTriples !== replayTriples) {
      bad += 1;
      console.error(`[verifyRollupParity] offer_category_participant_day rows for ${day}: replay=${replayTriples} db=${dbTriples}`);
    }
    if (bad > 0) {
      process.exitCode = 1;
      return;
    }
    console.log(`[verifyRollupParity] OK offer_outcome_category (${dims.size} dims) and offer_category_participant_day (${dbTriples} rows) match RPC replay for ${day}`);
  }

  } finally {
    await pool.end().catch(() => {});
  }
  if (process.exitCode === 1) process.exit(1);
}


main().catch(async (e) => {
  console.error(e);
  try {
    await pool?.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
