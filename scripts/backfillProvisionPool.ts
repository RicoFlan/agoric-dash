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
 * **A failure is never read as an answer.** Two ways that could happen here, both closed:
 *   - The height search asks for blocks the node may not retain. Rather than guess from an error
 *     message which failures mean "too old", the search starts at the height every configured
 *     endpoint reports it can serve, so nothing below retention is ever probed and any error left
 *     is genuinely transient — retried, then fatal.
 *   - `abci_query` reports failure IN a 200 response: a height below retention comes back as
 *     `code: 38`, a height before vstorage existed as a `code: 111222` panic, both with no value.
 *     Read as "nothing published that day" those become silent holes that the checkpoint then
 *     certifies as covered. Any nonzero code is an UNANSWERED day instead, and coverage stops at
 *     the first one rather than jumping over it.
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
import { ProvisionPoolAccumulator, persistProvisionPool, type ProvisionPoolDayRow } from "../src/lib/provisionPoolRollup";
import { PROVISION_POOL_METRICS_PATH, summarizeProvisionPoolMetrics } from "../src/lib/provisionPoolVstorage";
import { parseCapData } from "../src/lib/walletOfferMarshal";
import { rpcCall, rpcCallWithFallback } from "../src/lib/rpc";
import { coverageCutoffDay } from "../src/lib/backfillCoverageCutoff";

const TAG = "[backfillProvisionPool]";
const DATABASE_URL = process.env.DATABASE_URL;
const RPC_URLS: readonly string[] = [
  process.env.RPC_URL ?? "https://main-a.rpc.agoric.net",
  process.env.RPC_URL_FALLBACK ?? "",
].filter((u) => u.length > 0);
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

/** Every error is transient here — the callers never probe a height outside retention. */
async function withRetry<T>(what: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < RETRIES) await sleep(Math.min(30_000, 400 * 2 ** (attempt - 1)));
    }
  }
  throw new Error(`${what}: ${String(lastErr)}`);
}

interface StatusResponse {
  sync_info: { earliest_block_height?: string; latest_block_height: string };
}

/**
 * The height window every configured endpoint can serve, from each one's own `status`.
 *
 * Taken as `max(earliest) .. min(latest)` rather than the primary's window, because a call can land
 * on any endpoint via fallback: a height the primary retains but the fallback has pruned would come
 * back as a retention error that looks exactly like a transient one. Bounding by the intersection
 * means no probe can be refused for being out of range, so an error is unambiguously a failure.
 */
async function servableRange(): Promise<{ floor: bigint; tip: bigint }> {
  const stats = await Promise.all(
    RPC_URLS.map((url) => withRetry(`status ${url}`, () => rpcCall<StatusResponse>(url, "status", {})))
  );
  let floor = BigInt(1);
  let tip: bigint | null = null;
  for (const st of stats) {
    const earliest = BigInt(st.sync_info.earliest_block_height ?? "1");
    const latest = BigInt(st.sync_info.latest_block_height);
    if (earliest > floor) floor = earliest;
    if (tip === null || latest < tip) tip = latest;
  }
  if (tip === null || tip < floor) throw new Error(`no servable height range across ${RPC_URLS.length} endpoint(s)`);
  return { floor, tip };
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
 * Last height at or before the end of `day`, or null when that is before `floor`.
 *
 * Every probe is inside the servable range, so no error is expected and none is interpreted: a
 * failure propagates rather than nudging a bound, which is what would let the search settle on a
 * height it never actually evaluated.
 */
async function heightAtEndOfDay(day: string, floor: bigint, tip: bigint): Promise<bigint | null> {
  const target = Date.parse(`${day}T00:00:00Z`) + MS_PER_DAY - 1;
  let lo = floor;
  let hi = tip;
  let best: bigint | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) / BigInt(2);
    const ms = await blockTimeMs(mid);
    if (ms <= target) {
      best = mid;
      lo = mid + BigInt(1);
    } else {
      hi = mid - BigInt(1);
    }
  }
  return best;
}

/**
 * What one day's read produced. `absent` is an answer — the node served the query and the path held
 * nothing at that height. `unanswered` is not, and must never be stored or checkpointed over.
 */
type DayRead =
  | { kind: "row"; row: ProvisionPoolDayRow }
  | { kind: "absent" }
  | { kind: "unanswered"; reason: string };

/** The metrics StreamCell as of `height`. */
async function metricsAtHeight(
  height: bigint
): Promise<{ kind: "value"; capData: string; cellHeight: string | null } | { kind: "absent" } | { kind: "unanswered"; reason: string }> {
  const reqBytes = QueryDataRequest.encode(QueryDataRequest.fromPartial({ path: VSTORAGE_PATH })).finish();
  const res = await withRetry(`vstorage @${height}`, () =>
    rpcCallWithFallback<{ response?: { value?: string; code?: number; log?: string } }>(RPC_URLS, "abci_query", {
      path: "/agoric.vstorage.Query/Data",
      data: toHex(reqBytes),
      prove: false,
      height: height.toString(),
    })
  );
  const response = res.response;
  if (!response) return { kind: "unanswered", reason: "abci_query returned no response object" };
  // A nonzero ABCI code arrives inside a successful JSON-RPC reply, so nothing above throws for it.
  const code = response.code ?? 0;
  if (code !== 0) {
    return { kind: "unanswered", reason: `abci code ${code}: ${String(response.log ?? "").slice(0, 200)}` };
  }
  if (!response.value) return { kind: "absent" };
  // Code 0 means the node answered, so a payload it cannot decode is a real defect, not a gap.
  let cell: { values?: string[]; blockHeight?: string };
  try {
    cell = JSON.parse(QueryDataResponse.decode(fromBase64(response.value)).value);
  } catch (e) {
    return { kind: "unanswered", reason: `undecodable payload: ${String(e).slice(0, 200)}` };
  }
  const values = cell.values ?? [];
  if (values.length === 0) return { kind: "absent" };
  // The last value is the state as of that height, which is what a cumulative counter means.
  return { kind: "value", capData: values[values.length - 1]!, cellHeight: cell.blockHeight ?? null };
}

async function readDay(day: string, floor: bigint, tip: bigint): Promise<DayRead> {
  const h = await heightAtEndOfDay(day, floor, tip);
  if (h === null) return { kind: "unanswered", reason: "day ends before the earliest retained block" };
  const m = await metricsAtHeight(h);
  if (m.kind !== "value") return m;
  const snap = summarizeProvisionPoolMetrics(parseCapData(m.capData));
  if (!snap) return { kind: "unanswered", reason: `@${h}: metrics cell decoded to nothing usable` };
  if (snap.walletsProvisioned === null || snap.totalMintedProvided === null) {
    return { kind: "unanswered", reason: `@${h}: metrics cell omitted walletsProvisioned or totalMintedProvided` };
  }
  return {
    kind: "row",
    row: {
      day,
      walletsProvisioned: snap.walletsProvisioned,
      totalMintedProvided: snap.totalMintedProvided,
      totalMintedConverted: snap.totalMintedConverted,
      brandBoardId: snap.brandBoardId,
      // Key the row by the height the value was PUBLISHED at, not the day-boundary height we
      // happened to query. That is what makes highest-height-wins agree with the live indexer,
      // which sees the publication itself and would otherwise look older and lose.
      updatedHeight: m.cellHeight ? BigInt(m.cellHeight) : h,
    },
  };
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

  const { floor, tip } = await servableRange();
  const days = utcDays(START_DAY, TO_DAY);
  console.error(
    `${TAG} ${days.length} days ${START_DAY}..${TO_DAY}, servable ${floor}..${tip} — one vstorage read per day, concurrency ${CONCURRENCY}; nothing is deleted`
  );

  const acc = new ProvisionPoolAccumulator();
  const t0 = Date.now();
  const reads = new Map<string, DayRead>();
  let read = 0;
  let absent = 0;
  let unanswered = 0;

  for (let i = 0; i < days.length; i += CONCURRENCY) {
    const slice = days.slice(i, i + CONCURRENCY);
    const results = await Promise.all(slice.map((day) => readDay(day, floor, tip)));
    slice.forEach((day, j) => {
      const r = results[j]!;
      reads.set(day, r);
      if (r.kind === "row") {
        acc.observe(r.row);
        read += 1;
      } else if (r.kind === "absent") {
        absent += 1;
      } else {
        unanswered += 1;
        console.error(`${TAG} ${day}: UNANSWERED — ${r.reason}`);
      }
    });
    console.error(
      `${TAG} ${Math.min(i + CONCURRENCY, days.length)}/${days.length} days — ${read} read, ${absent} empty, ${unanswered} unanswered; ${Math.round((Date.now() - t0) / 1000)}s`
    );
  }

  await persistProvisionPool(db, acc);

  // The checkpoint records how far coverage extends, and the read path derives availability from
  // it, so it must stop at the first day we could not get an answer for.
  const firstHoleDay = coverageCutoffDay(days, (day) =>
    reads.get(day)?.kind === "unanswered" ? "unanswered" : "answered"
  );

  let maxHeight = BigInt(0);
  for (const r of acc.days.values()) {
    if (firstHoleDay !== null && r.day >= firstHoleDay) continue;
    if (r.updatedHeight > maxHeight) maxHeight = r.updatedHeight;
  }
  if (maxHeight > BigInt(0)) {
    await db
      .insert(backfillCheckpoint)
      .values({ job: JOB, lastHeight: maxHeight, updatedAt: new Date() })
      .onConflictDoUpdate({ target: backfillCheckpoint.job, set: { lastHeight: maxHeight, updatedAt: new Date() } });
  }

  console.error(
    `${TAG} done — ${acc.size} day rows, ${absent} days with nothing published, checkpoint ${maxHeight}, ${Math.round((Date.now() - t0) / 1000)}s`
  );
  await pool.end();

  if (unanswered > 0) {
    console.error(
      `${TAG} FAILED: ${unanswered} day(s) went unanswered${firstHoleDay ? `; coverage held back to before ${firstHoleDay}` : " (all before coverage began)"}. Rows written are correct; re-run to fill them.`
    );
    process.exit(1);
  }
}

main().catch(async (e) => {
  console.error(`${TAG} failed:`, e);
  await pool.end().catch(() => {});
  process.exit(1);
});
