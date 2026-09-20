/**
 * Backfill `bundle_install` from `tx_search`, one indexed query rather than a block scan.
 *
 * Bundle installs are rare — 30 between 2026-01-10 and 2026-09-10 — and CometBFT already indexes
 * transactions by `message.action`, so asking for them directly costs a handful of requests where
 * replaying blocks would cost millions. Same reasoning as the provisioning backfill: scan only
 * what cannot be asked for.
 *
 * Writing is idempotent by construction. `bundle_install` is keyed by tx hash, so re-running this,
 * interrupting it, or running it while the live indexer writes the same transactions all converge
 * on the same rows. There is no additive double-count hazard here and no FULL/RESUME mode.
 *
 * **Only successful installs exist to be found.** A failed tx discards its message events, so
 * `message.action` never matches one — the same blind spot the live indexer has, for the same
 * reason. A failed install pays gas and no storage fee.
 *
 * **The completeness guard.** A pruned node answers this query with whatever its transaction index
 * happens to retain and reports no error: one public endpoint returned 2 of the 101 installs on
 * chain. A short answer is indistinguishable from a true one, so the run refuses any endpoint that
 * will not state an `earliest_block_height` at or below the requested start. Set
 * BACKFILL_ALLOW_UNVERIFIED_INDEX=1 to override, and expect silent gaps if you do.
 *
 * Env: DATABASE_URL, RPC_URL[, RPC_URL_FALLBACK], INDEXER_START_DATE (default 2026-01-01),
 *      BACKFILL_ALLOW_UNVERIFIED_INDEX
 *
 * Run: npm run backfill:bundle-installs
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../src/db/schema";
import { backfillCheckpoint } from "../src/db/schema";
import { ensureBackfillCheckpointTable, ensureBundleInstallTable } from "../src/db/ensureAdditiveTables";
import { BundleInstallAccumulator, accumulateBundleInstall, persistBundleInstalls } from "../src/lib/bundleInstallRollup";
import { MSG_INSTALL_BUNDLE } from "../src/lib/bundleInstallFees";
import { rpcCall, rpcCallWithFallback } from "../src/lib/rpc";

const TAG = "[backfillBundleInstalls]";
const DATABASE_URL = process.env.DATABASE_URL;
const RPC_URLS: readonly string[] = [
  process.env.RPC_URL ?? "https://main-a.rpc.agoric.net",
  process.env.RPC_URL_FALLBACK ?? "",
].filter((u) => u.length > 0);
const START_DAY = (process.env.INDEXER_START_DATE ?? "2026-01-01").slice(0, 10);
const ALLOW_UNVERIFIED = process.env.BACKFILL_ALLOW_UNVERIFIED_INDEX === "1";
const JOB = "bundle_install";
const PER_PAGE = 50;

if (!DATABASE_URL) {
  console.error(`${TAG} DATABASE_URL is required`);
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema });

interface StatusResponse {
  sync_info: { earliest_block_height?: string; latest_block_height: string };
}
interface TxEvent {
  type: string;
  attributes?: Array<{ key: string; value: string }>;
}
interface TxSearchResponse {
  total_count: string;
  txs?: Array<{
    hash: string;
    height: string;
    tx_result: { code?: number; events?: TxEvent[] };
  }>;
}

/** tx_search serves attributes already decoded; normalise the optional field away. */
function eventKVs(events: TxEvent[] | undefined): Array<{ type: string; attributes: { key: string; value: string }[] }> {
  return (events ?? []).map((e) => ({
    type: e.type,
    attributes: (e.attributes ?? []).map((a) => ({ key: a.key, value: a.value })),
  }));
}

/**
 * The endpoints whose transaction index can be trusted for this range.
 *
 * `earliest_block_height` of 0 or absent is treated as a refusal, not as genesis: the node that
 * reports 0 here is the one whose index returned 2 of the 101 matches on chain. Endpoints that
 * cannot vouch are DROPPED rather than fatal — a pruned fallback behind an archive primary is a
 * normal configuration, and the run only needs one endpoint that can answer completely. It is
 * fatal only when none can, because then every answer would be a short list with no error.
 */
async function verifiedEndpoints(fromHeight: bigint): Promise<{ urls: string[]; tip: bigint }> {
  const urls: string[] = [];
  let tip = BigInt(0);
  for (const url of RPC_URLS) {
    let st: StatusResponse;
    try {
      st = await rpcCall<StatusResponse>(url, "status", {});
    } catch (e) {
      console.error(`${TAG} dropping ${url}: status failed (${e instanceof Error ? e.message : String(e)})`);
      continue;
    }
    const earliest = BigInt(st.sync_info.earliest_block_height ?? "0");
    const latest = BigInt(st.sync_info.latest_block_height);
    if (earliest > BigInt(0) && earliest <= fromHeight) {
      urls.push(url);
      if (latest > tip) tip = latest;
      continue;
    }
    const why =
      earliest === BigInt(0)
        ? "reports no earliest_block_height, so its transaction index cannot be vouched for"
        : `retains only from height ${earliest}, above the requested start ${fromHeight}`;
    if (ALLOW_UNVERIFIED) {
      console.error(`${TAG} WARNING: keeping ${url} although it ${why} (BACKFILL_ALLOW_UNVERIFIED_INDEX=1)`);
      urls.push(url);
      if (latest > tip) tip = latest;
    } else {
      console.error(`${TAG} dropping ${url}: it ${why}`);
    }
  }
  if (urls.length === 0) {
    console.error(`${TAG} no endpoint can vouch for a complete transaction index at or after ${fromHeight}.`);
    console.error(`${TAG} A pruned index answers with a SHORT list and no error, so this is fatal.`);
    console.error(`${TAG} Point RPC_URL at an archive, or set BACKFILL_ALLOW_UNVERIFIED_INDEX=1 to accept gaps.`);
    process.exit(1);
  }
  return { urls, tip };
}

/** First height at or after the start day, by binary search over retained blocks. */
async function heightAtStartOfDay(day: string, floor: bigint, tip: bigint): Promise<bigint> {
  const target = Date.parse(`${day}T00:00:00Z`);
  let lo = floor;
  let hi = tip;
  let best = tip;
  while (lo <= hi) {
    const mid = (lo + hi) / BigInt(2);
    const b = await rpcCallWithFallback<{ block: { header: { time: string } } }>(RPC_URLS, "block", {
      height: mid.toString(),
    });
    const ms = new Date(b.block.header.time).getTime();
    if (!Number.isFinite(ms)) throw new Error(`invalid block time at ${mid}`);
    if (ms >= target) {
      best = mid;
      hi = mid - BigInt(1);
    } else {
      lo = mid + BigInt(1);
    }
  }
  return best;
}

async function blockDay(height: string, urls: readonly string[]): Promise<string> {
  const b = await rpcCallWithFallback<{ block: { header: { time: string } } }>(urls, "block", { height });
  return b.block.header.time.slice(0, 10);
}

async function main() {
  await ensureBackfillCheckpointTable(db);
  await ensureBundleInstallTable(db);

  const firstStatus = await rpcCall<StatusResponse>(RPC_URLS[0]!, "status", {});
  const floor = BigInt(firstStatus.sync_info.earliest_block_height ?? "1") || BigInt(1);
  const tipEarly = BigInt(firstStatus.sync_info.latest_block_height);
  const fromHeight = await heightAtStartOfDay(START_DAY, floor, tipEarly);
  const { urls: searchUrls, tip } = await verifiedEndpoints(fromHeight);

  const query = `message.action='${MSG_INSTALL_BUNDLE}' AND tx.height>=${fromHeight}`;
  const acc = new BundleInstallAccumulator();
  const dayCache = new Map<string, string>();
  let expected: number | null = null;
  let seen = 0;

  for (let page = 1; ; page++) {
    const res = await rpcCallWithFallback<TxSearchResponse>(searchUrls, "tx_search", {
      query,
      page: String(page),
      per_page: String(PER_PAGE),
      order_by: "asc",
    });
    const total = Number(res.total_count);
    if (expected === null) {
      expected = total;
      console.error(`${TAG} ${total} install tx(s) at or after height ${fromHeight} (${START_DAY}), tip ${tip}`);
    } else if (total !== expected) {
      // The set moved under us mid-page; re-running is cheap and the rows are idempotent.
      throw new Error(`total_count changed from ${expected} to ${total} between pages — re-run`);
    }
    const txs = res.txs ?? [];
    if (txs.length === 0) break;
    for (const tx of txs) {
      let day = dayCache.get(tx.height);
      if (day === undefined) {
        day = await blockDay(tx.height, searchUrls);
        dayCache.set(tx.height, day);
      }
      accumulateBundleInstall(acc, {
        txHash: tx.hash.toUpperCase(),
        height: BigInt(tx.height),
        day,
        // tx_search matched on message.action, which only a successful tx emits.
        typeUrls: [MSG_INSTALL_BUNDLE],
        events: eventKVs(tx.tx_result.events),
      });
      seen += 1;
    }
    if (seen >= total) break;
  }

  if (expected !== null && acc.size !== expected) {
    throw new Error(`collected ${acc.size} rows but the index reported ${expected} — refusing to write a partial set`);
  }

  await persistBundleInstalls(db, acc);
  await db
    .insert(backfillCheckpoint)
    .values({ job: JOB, lastHeight: tip, updatedAt: new Date() })
    .onConflictDoUpdate({ target: backfillCheckpoint.job, set: { lastHeight: tip, updatedAt: new Date() } });

  const storage = [...acc.rows.values()].reduce((n, r) => n + BigInt(r.storageFeeUbld), BigInt(0));
  const gas = [...acc.rows.values()].reduce((n, r) => n + BigInt(r.gasFeeUbld), BigInt(0));
  console.error(
    `${TAG} done — ${acc.size} installs, gas ${gas} ubld, storage ${storage} ubld, checkpoint ${tip}`
  );
  await pool.end();
}

main().catch(async (e) => {
  console.error(`${TAG} failed:`, e);
  await pool.end().catch(() => {});
  process.exit(1);
});
