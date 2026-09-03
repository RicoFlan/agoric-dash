/**
 * DESTRUCTIVE full-reindex reset. Truncates all indexer-owned rollup tables and clears the indexer
 * cursor so the next `npm run indexer` run replays the full indexed span (from INDEXER_START_DATE)
 * and recomputes every series from scratch.
 *
 * Why a full replay (not an additive backfill): the rollup upserts in `scripts/indexer.ts` are
 * **additive** (`value + excluded.value`). Replaying blocks on top of existing rows double-counts.
 * Some Phase B changes also **redefine** an existing series' value (e.g. `ibc_transfer_amount_in`
 * moved from a 2x combined sum to a deduped per-denom max), so a targeted additive backfill cannot
 * correct them — the rows must be rebuilt.
 *
 * Tables truncated: daily_metrics, hourly_metrics, participant_day, address_volume_day,
 * address_fee_day, offer_participant_day, offer_category_participant_day. The indexer_state singleton row is deleted so `getCursor()`
 * returns 0 and the indexer starts from the configured start date.
 *
 * SAFETY: this wipes indexed data. It only runs when `REINDEX_CONFIRM=YES` is set in the environment.
 *
 * Operational ordering (IMPORTANT): the running indexer must NOT be writing while this runs, or it
 * will re-persist a stale cursor / partial rows after the truncate. On Railway: stop/pause the
 * indexer service, run this once, then start the indexer again (it will catch up from the start
 * date). See docs/DEVELOPMENT.md "Full reindex (Railway)".
 *
 * Usage:
 *   DATABASE_URL=... REINDEX_CONFIRM=YES npx tsx scripts/reindexReset.ts
 *   # or: DATABASE_URL=... REINDEX_CONFIRM=YES npm run reindex:reset
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../src/db/schema";

const DATABASE_URL = process.env.DATABASE_URL;
const CONFIRM = (process.env.REINDEX_CONFIRM ?? "").trim().toUpperCase() === "YES";

if (!DATABASE_URL) {
  console.error("[reindexReset] DATABASE_URL required");
  process.exit(1);
}
if (!CONFIRM) {
  console.error(
    "[reindexReset] Refusing to run: this DESTRUCTIVELY truncates all rollup tables and clears the indexer cursor."
  );
  console.error("[reindexReset] Re-run with REINDEX_CONFIRM=YES once the indexer is stopped.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema });

/** Physical table names truncated for a clean full rebuild (all written by the indexer). */
const ROLLUP_TABLES = [
  "daily_metrics",
  "hourly_metrics",
  "participant_day",
  "address_volume_day",
  "address_fee_day",
  "offer_participant_day",
  "offer_category_participant_day",
] as const;

async function countRows(table: string): Promise<string> {
  const res = await pool.query(`SELECT count(*)::text AS n FROM ${table}`);
  return res.rows[0]?.n ?? "?";
}

async function main() {
  console.error("[reindexReset] BEFORE row counts:");
  for (const t of ROLLUP_TABLES) {
    console.error(`  ${t}: ${await countRows(t)}`);
  }
  const cursorBefore = await pool.query(
    "SELECT last_indexed_height::text AS h FROM indexer_state WHERE id = 'singleton'"
  );
  console.error(`  indexer_state cursor: ${cursorBefore.rows[0]?.h ?? "<none>"}`);

  await db.transaction(async (tx) => {
    await tx.execute(
      sql.raw(
        `TRUNCATE TABLE ${ROLLUP_TABLES.join(", ")} RESTART IDENTITY`
      )
    );
    await tx.execute(sql.raw("DELETE FROM indexer_state WHERE id = 'singleton'"));
  });

  console.error("[reindexReset] AFTER row counts:");
  for (const t of ROLLUP_TABLES) {
    console.error(`  ${t}: ${await countRows(t)}`);
  }
  const cursorAfter = await pool.query(
    "SELECT last_indexed_height::text AS h FROM indexer_state WHERE id = 'singleton'"
  );
  console.error(`  indexer_state cursor: ${cursorAfter.rows[0]?.h ?? "<none>"}`);
  console.error(
    "[reindexReset] done. Start the indexer (npm run indexer) to replay from INDEXER_START_DATE."
  );
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
