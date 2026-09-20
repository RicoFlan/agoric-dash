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
import { MSG_INSTALL_BUNDLE, typeUrlsFromEvents } from "../src/lib/bundleInstallFees";
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
 * Checked against the START DAY'S TIME, not against a height derived from an endpoint. Deriving
 * the height first was self-defeating: the binary search ran over `[earliest, tip]` of the FIRST
 * endpoint, so a pruned one converged on its own pruning point, and the check `earliest <=
 * fromHeight` then compared it against itself and passed. The endpoint vouched for itself and the
 * run wrote a short set — the exact failure the guard exists to prevent.
 *
 * An endpoint qualifies when the block it says is its earliest is dated at or before the start of
 * the requested range. `earliest_block_height` of 0 or absent is a refusal, not genesis: the node
 * reporting 0 is the one whose index returned 2 of the 101 matches on chain.
 *
 * Endpoints that cannot vouch are DROPPED, not fatal — a pruned fallback behind an archive primary
 * is a normal configuration. It is fatal only when none can vouch.
 */
async function verifiedEndpoints(startDay: string): Promise<{ urls: string[]; floor: bigint; tip: bigint }> {
  const startMs = Date.parse(`${startDay}T00:00:00Z`);
  const urls: string[] = [];
  let floor = BigInt(0);
  let tip = BigInt(0);

  for (const url of RPC_URLS) {
    let why: string;
    try {
      const st = await rpcCall<StatusResponse>(url, "status", {});
      const earliest = BigInt(st.sync_info.earliest_block_height ?? "0");
      const latest = BigInt(st.sync_info.latest_block_height);
      if (earliest > BigInt(0)) {
        const b = await rpcCall<{ block: { header: { time: string } } }>(url, "block", {
          height: earliest.toString(),
        });
        const earliestMs = new Date(b.block.header.time).getTime();
        if (Number.isFinite(earliestMs) && earliestMs <= startMs) {
          urls.push(url);
          if (earliest > floor) floor = earliest;
          if (latest > tip) tip = latest;
          continue;
        }
        why = `its earliest block ${earliest} is dated ${new Date(earliestMs).toISOString().slice(0, 10)}, after ${startDay}`;
      } else {
        why = "reports no earliest_block_height, so its transaction index cannot be vouched for";
      }
      if (ALLOW_UNVERIFIED) {
        console.error(`${TAG} WARNING: keeping ${url} although ${why} (BACKFILL_ALLOW_UNVERIFIED_INDEX=1)`);
        urls.push(url);
        if (earliest > floor) floor = earliest;
        if (latest > tip) tip = latest;
      } else {
        console.error(`${TAG} dropping ${url}: ${why}`);
      }
    } catch (e) {
      console.error(`${TAG} dropping ${url}: status/block failed (${e instanceof Error ? e.message : String(e)})`);
    }
  }

  if (urls.length === 0 || tip === BigInt(0)) {
    console.error(`${TAG} no endpoint can vouch for a complete transaction index covering ${startDay}.`);
    console.error(`${TAG} A pruned index answers with a SHORT list and no error, so this is fatal.`);
    console.error(`${TAG} Point RPC_URL at an archive, or set BACKFILL_ALLOW_UNVERIFIED_INDEX=1 to accept gaps.`);
    process.exit(1);
  }
  return { urls, floor: floor > BigInt(0) ? floor : BigInt(1), tip };
}

/** First height at or after the start of `day`, searched only over verified endpoints. */
async function heightAtStartOfDay(day: string, floor: bigint, tip: bigint, urls: readonly string[]): Promise<bigint> {
  const target = Date.parse(`${day}T00:00:00Z`);
  let lo = floor;
  let hi = tip;
  let best = tip;
  while (lo <= hi) {
    const mid = (lo + hi) / BigInt(2);
    const b = await rpcCallWithFallback<{ block: { header: { time: string } } }>(urls, "block", {
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

/**
 * Confirm the search really landed on the first block of `day`.
 *
 * Belt and braces over the endpoint check above: `fromHeight` is only meaningful if the block
 * before it predates the day. If the two disagree the search was bounded by something other than
 * the chain's own history, and continuing would silently narrow the query.
 */
async function assertFirstBlockOfDay(fromHeight: bigint, day: string, urls: readonly string[]): Promise<void> {
  const startMs = Date.parse(`${day}T00:00:00Z`);
  const at = await rpcCallWithFallback<{ block: { header: { time: string } } }>(urls, "block", {
    height: fromHeight.toString(),
  });
  const atMs = new Date(at.block.header.time).getTime();
  if (!(atMs >= startMs)) {
    throw new Error(`height ${fromHeight} is dated before ${day}; the start search did not converge`);
  }
  const prev = await rpcCallWithFallback<{ block: { header: { time: string } } }>(urls, "block", {
    height: (fromHeight - BigInt(1)).toString(),
  });
  const prevMs = new Date(prev.block.header.time).getTime();
  if (!(prevMs < startMs)) {
    throw new Error(
      `height ${fromHeight} is not the first block of ${day} — ${fromHeight - BigInt(1)} is also at or after it, ` +
        `so the search was bounded by endpoint retention rather than by the chain`
    );
  }
}

async function blockDay(height: string, urls: readonly string[]): Promise<string> {
  const b = await rpcCallWithFallback<{ block: { header: { time: string } } }>(urls, "block", { height });
  return b.block.header.time.slice(0, 10);
}

async function main() {
  await ensureBackfillCheckpointTable(db);
  await ensureBundleInstallTable(db);

  // Verify endpoints FIRST, then derive the start height using only the verified ones. The other
  // order lets a pruned endpoint define the bound it is then checked against.
  const { urls: searchUrls, floor, tip } = await verifiedEndpoints(START_DAY);
  const fromHeight = await heightAtStartOfDay(START_DAY, floor, tip, searchUrls);
  await assertFirstBlockOfDay(fromHeight, START_DAY, searchUrls);

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
      const events = eventKVs(tx.tx_result.events);
      // The REAL message list, from the tx's own `message` events — not an assumed
      // [MSG_INSTALL_BUNDLE]. A mixed tx must be recognised here exactly as the indexer
      // recognises it, or the two writers would disagree about the same transaction.
      const typeUrls = typeUrlsFromEvents(events);
      accumulateBundleInstall(acc, {
        txHash: tx.hash.toUpperCase(),
        height: BigInt(tx.height),
        day,
        typeUrls: typeUrls.includes(MSG_INSTALL_BUNDLE) ? typeUrls : [...typeUrls, MSG_INSTALL_BUNDLE],
        events,
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

  const rows = [...acc.rows.values()];
  const storage = rows.reduce((n, r) => n + BigInt(r.storageFeeUbld ?? "0"), BigInt(0));
  const gas = rows.reduce((n, r) => n + BigInt(r.gasFeeUbld), BigInt(0));
  const ambiguous = rows.filter((r) => r.storageFeeUbld === null).length;
  console.error(
    `${TAG} done — ${acc.size} installs, gas ${gas} ubld, storage ${storage} ubld` +
      (ambiguous > 0 ? `, ${ambiguous} mixed tx(s) with no attributable storage fee` : "") +
      `, checkpoint ${tip}`
  );
  await pool.end();
}

main().catch(async (e) => {
  console.error(`${TAG} failed:`, e);
  await pool.end().catch(() => {});
  process.exit(1);
});
