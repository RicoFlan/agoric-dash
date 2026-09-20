/**
 * Backfill `provision_pool_day` by reading `published.provisionPool.metrics` AT one height per day.
 *
 * **Why this does not scan blocks.** Every other backfill here replays `block_results` because the
 * data it needs exists only as events. This one does not: the provision pool's counters are
 * cumulative state, and the archive answers `abci_query` at an arbitrary past height, so the value
 * as of any day can be read directly. Scanning was measured first and rejected — 4,091,951 blocks
 * × 2 calls is 8.2 million requests at roughly 14 blocks/s, about 80 hours, to recover one number
 * per day. Reading per day is ~520 requests, and it returns the same snapshots, because a
 * cumulative counter has no per-block detail to lose.
 *
 * The live indexer still watches `state_change` events (provisionPoolRollup.ts). That is right for
 * the tail, where the blocks are being fetched anyway; only history is cheaper to ask for directly.
 *
 * Nothing is deleted and nothing is additive: each day is upserted highest-height-wins, so the run
 * is safe to repeat, to interrupt, and to run while the live indexer writes the same days.
 *
 * Env: DATABASE_URL, RPC_URL[, RPC_URL_FALLBACK], INDEXER_START_DATE (default 2026-01-01),
 *      BACKFILL_TO_DAY (default: today UTC), BACKFILL_CONCURRENCY (6), INDEXER_RPC_RETRIES (6)
 *
 * Run: npm run backfill:provision-pool
 */
import "dotenv/config";
import { toHex, fromBase64 } from "@cosmjs/encoding";
import { QueryDataRequest, QueryDataResponse } from "@agoric/cosmic-proto/vstorage/query.js";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../src/db/schema";
import { backfillCheckpoint } from "../src/db/schema";
import { ensureBackfillCheckpointTable, ensureProvisionPoolDayTable } from "../src/db/ensureAdditiveTables";
import { ProvisionPoolAccumulator, persistProvisionPool } from "../src/lib/provisionPoolRollup";
import { PROVISION_POOL_METRICS_PATH, summarizeProvisionPoolMetrics } from "../src/lib/provisionPoolVstorage";
import { parseCapData } from "../src/lib/walletOfferMarshal";
import { rpcCallWithFallback } from "../src/lib/rpc";

const TAG = "[backfillProvisionPool]";
const DATABASE_URL = process.env.DATABASE_URL;
const RPC_URLS: readonly string[] = [
  process.env.RPC_URL ?? "https://main-a.rpc.agoric.net",
  process.env.RPC_URL_FALLBACK ?? "",
];
const VSTORAGE_PATH = PROVISION_POOL_METRICS_PATH.join(".");
const START_DAY = (process.env.INDEXER_START_DATE ?? "2026-01-01").slice(0, 10);
const TO_DAY = (process.env.BACKFILL_TO_DAY ?? new Date().toISOString()).slice(0, 10);
const CONCURRENCY = Math.max(1, Math.min(16, Number(process.env.BACKFILL_CONCURRENCY ?? "6")));
const RETRIES = Math.max(1, Number(process.env.INDEXER_RPC_RETRIES ?? "6"));
const JOB = "provision_pool";

if (!DATABASE_URL) {
  console.error(`${TAG} DATABASE_URL is required`);
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MS_PER_DAY = 86_400_000;

/** A height the node will never serve, as opposed to a call that merely failed. */
function isUnservableHeight(e: unknown): boolean {
  const msg = String((e as { message?: unknown } | null)?.message ?? e ?? "");
  return /lowest height|is not available|height .* is below|Internal error/i.test(msg);
}

async function withRetry<T>(what: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (isUnservableHeight(e)) throw e;
      if (attempt < RETRIES) await sleep(Math.min(30_000, 400 * 2 ** (attempt - 1)));
    }
  }
  throw new Error(`${what}: ${String(lastErr)}`);
}

async function latestHeight(): Promise<bigint> {
  const st = await withRetry("status", () =>
    rpcCallWithFallback<{ sync_info: { latest_block_height: string } }>(RPC_URLS, "status", {})
  );
  return BigInt(st.sync_info.latest_block_height);
}

async function blockTimeMs(height: bigint): Promise<number> {
  const b = await withRetry(`block ${height}`, () =>
    rpcCallWithFallback<{ block: { header: { time: string } } }>(RPC_URLS, "block", { height: height.toString() })
  );
  const ms = new Date(b?.block?.header?.time ?? "").getTime();
  if (!Number.isFinite(ms)) throw new Error(`invalid block time at ${height}`);
  return ms;
}

/**
 * Last height at or before the end of `day`, or null when the chain has none.
 *
 * A failed probe is never read as an answer: only an explicitly unservable height counts as below
 * the node's retention. Anything else propagates, so the run fails loudly rather than silently
 * settling on a height it never evaluated.
 */
async function heightAtEndOfDay(day: string, tip: bigint): Promise<bigint | null> {
  const target = Date.parse(`${day}T00:00:00Z`) + MS_PER_DAY - 1;
  let lo = BigInt(1);
  let hi = tip;
  let best: bigint | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) / BigInt(2);
    let ms: number;
    try {
      ms = await blockTimeMs(mid);
    } catch (e) {
      if (!isUnservableHeight(e)) throw e;
      lo = mid + BigInt(1);
      continue;
    }
    if (ms <= target) {
      best = mid;
      lo = mid + BigInt(1);
    } else {
      hi = mid - BigInt(1);
    }
  }
  return best;
}

/** The metrics StreamCell as of `height`, or null when the path held nothing then. */
async function metricsAtHeight(height: bigint): Promise<{ capData: string; cellHeight: string | null } | null> {
  const reqBytes = QueryDataRequest.encode(QueryDataRequest.fromPartial({ path: VSTORAGE_PATH })).finish();
  const res = await withRetry(`vstorage @${height}`, () =>
    rpcCallWithFallback<{ response: { value?: string; code?: number; log?: string } }>(RPC_URLS, "abci_query", {
      path: "/agoric.vstorage.Query/Data",
      data: toHex(reqBytes),
      prove: false,
      height: height.toString(),
    })
  );
  if (!res.response?.value) return null;
  let cell: { values?: string[]; blockHeight?: string };
  try {
    cell = JSON.parse(QueryDataResponse.decode(fromBase64(res.response.value)).value);
  } catch {
    return null;
  }
  const values = cell.values ?? [];
  if (values.length === 0) return null;
  // The last value is the state as of that height, which is what a cumulative counter means.
  return { capData: values[values.length - 1]!, cellHeight: cell.blockHeight ?? null };
}

function utcDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += MS_PER_DAY) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

async function main() {
  await ensureBackfillCheckpointTable(db);
  await ensureProvisionPoolDayTable(db);

  const tip = await latestHeight();
  const days = utcDays(START_DAY, TO_DAY);
  console.error(
    `${TAG} ${days.length} days ${START_DAY}..${TO_DAY}, tip ${tip} — one vstorage read per day, concurrency ${CONCURRENCY}; nothing is deleted`
  );

  const acc = new ProvisionPoolAccumulator();
  const t0 = Date.now();
  let read = 0;
  let missing = 0;
  let maxHeight = BigInt(0);

  for (let i = 0; i < days.length; i += CONCURRENCY) {
    const slice = days.slice(i, i + CONCURRENCY);
    const rows = await Promise.all(
      slice.map(async (day) => {
        const h = await heightAtEndOfDay(day, tip);
        if (h === null) return null;
        const m = await metricsAtHeight(h);
        if (!m) return null;
        const snap = summarizeProvisionPoolMetrics(parseCapData(m.capData));
        if (!snap || snap.walletsProvisioned === null || snap.totalMintedProvided === null) return null;
        // Key the row by the height the value was PUBLISHED at, not the day-boundary height we
        // happened to query. That is what makes highest-height-wins agree with the live indexer,
        // which sees the publication itself and would otherwise look older and lose.
        return {
          day,
          walletsProvisioned: snap.walletsProvisioned,
          totalMintedProvided: snap.totalMintedProvided,
          totalMintedConverted: snap.totalMintedConverted,
          brandBoardId: snap.brandBoardId,
          updatedHeight: m.cellHeight ? BigInt(m.cellHeight) : h,
        };
      })
    );
    for (const row of rows) {
      if (!row) {
        missing += 1;
        continue;
      }
      acc.observe(row);
      read += 1;
      if (row.updatedHeight > maxHeight) maxHeight = row.updatedHeight;
    }
    console.error(
      `${TAG} ${Math.min(i + CONCURRENCY, days.length)}/${days.length} days — ${read} read, ${missing} with no value; ${Math.round((Date.now() - t0) / 1000)}s`
    );
  }

  await persistProvisionPool(db, acc);
  // The checkpoint records how far coverage extends, and the read path derives availability from
  // it, so it must be the highest height whose value was actually stored.
  if (maxHeight > BigInt(0)) {
    await db
      .insert(backfillCheckpoint)
      .values({ job: JOB, lastHeight: maxHeight, updatedAt: new Date() })
      .onConflictDoUpdate({ target: backfillCheckpoint.job, set: { lastHeight: maxHeight, updatedAt: new Date() } });
  }
  console.error(
    `${TAG} done — ${acc.size} day rows, checkpoint ${maxHeight}, ${Math.round((Date.now() - t0) / 1000)}s`
  );
  await pool.end();
}

main().catch(async (e) => {
  console.error(`${TAG} failed:`, e);
  await pool.end().catch(() => {});
  process.exit(1);
});
