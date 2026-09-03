/**
 * Backfill `denom_price_day` from CoinGecko `/market_chart` for every configured coin id.
 *
 * Additive and idempotent: creates the table IF NOT EXISTS, upserts by (day, coingecko_id), never
 * deletes. Safe to re-run; re-running simply refreshes the rows it touches. Rollup tables are not read
 * or written. Free tier caps history at 365 days, which covers INDEXED_HISTORY_FROM_DAY today.
 *
 * Env:
 *   DATABASE_URL            — required
 *   COINGECKO_API_KEY       — optional Demo key (recommended; raises the rate limit)
 *   PRICE_BACKFILL_DAYS     — history depth, default 365 (max 365)
 *   PRICE_BACKFILL_IDS      — optional comma-separated coin ids to restrict the run
 *   PRICE_REQUEST_DELAY_MS  — pause between requests, default 2500
 *
 * Run: npm run backfill:prices
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../src/db/schema";
import { refreshDailyPrices } from "../src/lib/coingecko/priceRefresh";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

/** Parse an env number; only a missing/non-numeric value takes the default (explicit 0 is preserved). */
function envNumber(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return process.env[name] !== undefined && Number.isFinite(n) ? n : fallback;
}
const days = Math.max(1, Math.min(365, envNumber("PRICE_BACKFILL_DAYS", 365)));
const delayMs = Math.max(0, envNumber("PRICE_REQUEST_DELAY_MS", 2500));
const ids = (process.env.PRICE_BACKFILL_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema });

async function main() {
  console.log(
    `[backfillDenomPrices] days=${days} delay=${delayMs}ms ids=${ids.length > 0 ? ids.join(",") : "<all configured>"} apiKey=${process.env.COINGECKO_API_KEY ? "yes" : "no"}`
  );
  const s = await refreshDailyPrices(db, { days, ids: ids.length > 0 ? ids : undefined, delayMs, log: console.log });
  console.log(
    `[backfillDenomPrices] done: ${s.idsOk}/${s.idsAttempted} ids ok, ${s.rowsUpserted} rows upserted` +
      (s.idsNotFound.length ? `; not found: ${s.idsNotFound.join(", ")}` : "") +
      (s.idsFailed.length ? `; failed: ${s.idsFailed.join(", ")}` : "")
  );
  await pool.end();
  if (s.idsFailed.length > 0) process.exitCode = 2;
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
