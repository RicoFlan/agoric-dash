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
 *
 * Env: PARITY_RPC_CONCURRENCY (default 12) — parallel block fetches for replay.
 */
import "dotenv/config";
import { and, eq, gte, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../src/db/schema";
import { accumulateIbcTransferFlowInFromBlock } from "../src/lib/ibcTransferFlowInRollup";
import {
  compareHourlyDailyParity,
  type DailyMetricRow,
  type HourlyMetricRow,
  utcDayMillisBounds,
} from "../src/lib/metricsRollupParity";
import {
  rpcCall,
  type RpcBlockResponse,
  type RpcBlockResultsResponse,
} from "../src/lib/rpc";
import { SERIES } from "../src/lib/semantics";

const DATABASE_URL = process.env.DATABASE_URL;
const RPC_URL = process.env.RPC_URL ?? "https://main.rpc.agoric.net";

const pool = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL }) : null;
const db = pool ? drizzle(pool, { schema }) : null;

function parseArgs(argv: string[]) {
  let day = "";
  let replay = false;
  for (const a of argv) {
    if (a.startsWith("--day=")) day = a.slice("--day=".length);
    else if (a === "--replay-ibc-flow-in") replay = true;
  }
  return { day, replay };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function rpcCallRetry<T>(rpcUrl: string, method: string, params: unknown): Promise<T> {
  const max = 8;
  let last: unknown;
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      return await rpcCall<T>(rpcUrl, method, params);
    } catch (e) {
      last = e;
      if (attempt === max) throw e;
      await sleep(250 * 2 ** (attempt - 1));
    }
  }
  throw last;
}

async function latestHeight(rpcUrl: string): Promise<bigint> {
  const st = await rpcCall<{ sync_info: { latest_block_height: string } }>(rpcUrl, "status", {});
  return BigInt(st.sync_info.latest_block_height);
}

async function blockTimeMsAtHeightOrNull(rpcUrl: string, height: bigint): Promise<number | null> {
  try {
    const block = await rpcCallRetry<RpcBlockResponse>(rpcUrl, "block", { height: height.toString() });
    const t = block.block?.header?.time;
    if (!t) return null;
    const ms = new Date(t).getTime();
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

async function findEarliestQueryableHeight(rpcUrl: string, tip: bigint): Promise<bigint> {
  let lo = BigInt(1);
  let hi = tip;
  while (lo < hi) {
    const mid = (lo + hi) / BigInt(2);
    const ok = (await blockTimeMsAtHeightOrNull(rpcUrl, mid)) !== null;
    if (ok) hi = mid;
    else lo = mid + BigInt(1);
  }
  return lo;
}

async function firstQueryableHeightFrom(
  rpcUrl: string,
  start: bigint,
  tip: bigint
): Promise<bigint> {
  let h = start;
  while (h <= tip) {
    if ((await blockTimeMsAtHeightOrNull(rpcUrl, h)) !== null) return h;
    h += BigInt(1);
  }
  return tip + BigInt(1);
}

async function findHeightAtOrAfterTime(
  rpcUrl: string,
  targetMs: number,
  tip: bigint
): Promise<bigint> {
  let earliestQueryable = await findEarliestQueryableHeight(rpcUrl, tip);
  earliestQueryable = await firstQueryableHeightFrom(rpcUrl, earliestQueryable, tip);
  const earliestMs = await blockTimeMsAtHeightOrNull(rpcUrl, earliestQueryable);
  if (earliestMs === null) return tip + BigInt(1);
  if (targetMs <= earliestMs) return earliestQueryable;

  const tipMs = await blockTimeMsAtHeightOrNull(rpcUrl, tip);
  if (tipMs === null) throw new Error("Tip block has no header time");
  if (targetMs > tipMs) return tip + BigInt(1);

  let lo = earliestQueryable;
  let hi = tip;
  while (lo < hi) {
    const mid = (lo + hi) / BigInt(2);
    const midMs = await blockTimeMsAtHeightOrNull(rpcUrl, mid);
    if (midMs === null) {
      lo = mid + BigInt(1);
      continue;
    }
    if (midMs < targetMs) lo = mid + BigInt(1);
    else hi = mid;
  }
  return await firstQueryableHeightFrom(rpcUrl, lo, tip);
}

async function fetchBlockPair(
  rpcUrl: string,
  height: bigint
): Promise<{ block: RpcBlockResponse; results: RpcBlockResultsResponse }> {
  const hStr = height.toString();
  const [block, results] = await Promise.all([
    rpcCallRetry<RpcBlockResponse>(rpcUrl, "block", { height: hStr }),
    rpcCallRetry<RpcBlockResultsResponse>(rpcUrl, "block_results", { height: hStr }),
  ]);
  return { block, results };
}

async function replayIbcFlowInForDay(
  rpcUrl: string,
  dayUtc: string,
  maxHeightInclusive: bigint
): Promise<bigint> {
  const { startMs, endMs } = utcDayMillisBounds(dayUtc);
  const tip = await latestHeight(rpcUrl);
  const tipBound = tip < maxHeightInclusive ? tip : maxHeightInclusive;

  const hStart = await findHeightAtOrAfterTime(rpcUrl, startMs, tipBound);
  const hEndExclusive = await findHeightAtOrAfterTime(rpcUrl, endMs, tipBound);

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
    const pairs = await Promise.all(batch.map((h) => fetchBlockPair(rpcUrl, h)));
    for (const { block, results } of pairs) {
      accumulateIbcTransferFlowInFromBlock(block, results, daily, hourly);
    }
  }

  const ROLLUP_KEY_DELIM = "\0";
  const key = [dayUtc, SERIES.IBC_TRANSFER_FLOW_IN, ""].join(ROLLUP_KEY_DELIM);
  return daily.get(key) ?? BigInt(0);
}

async function main() {
  const { day, replay } = parseArgs(process.argv.slice(2));
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
    const replayed = await replayIbcFlowInForDay(RPC_URL, day, cursorH);

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
