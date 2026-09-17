/**
 * Deploy-time schema step: create missing additive tables, then VERIFY and fail loudly on drift.
 *
 * Replaces `drizzle-kit push` in the pre-deploy command. Push is a development tool — it diffs the
 * live database and then issues ALTER and DROP statements unattended, and on PostgreSQL 17+ it
 * misreads the new named NOT NULL constraints as extras and tries to drop all of them. Its npm
 * wrapper also exits 0 when that fails, so a broken schema step looked like a green deploy.
 *
 * This script never alters or drops anything. It only creates tables that do not exist, using the
 * same `CREATE TABLE IF NOT EXISTS` statements the backfill scripts already rely on. Everything
 * else it checks and reports, exiting non-zero so the deploy fails where you can see it.
 *
 * Env: DATABASE_URL
 * Run: npm run db:ensure
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../src/db/schema";
import { ADDITIVE_TABLE_NAMES, ensureAllAdditiveTables } from "../src/db/ensureAdditiveTables";
import {
  describeProblem,
  diffSchema,
  expectedTables,
  type LiveColumn,
  type LivePrimaryKey,
} from "../src/db/schemaExpectations";

const TAG = "[ensureSchema]";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(`${TAG} DATABASE_URL is required.`);
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 15_000 });
  const db = drizzle(pool, { schema });

  try {
    // Additive creates only. Each is CREATE TABLE IF NOT EXISTS, so a re-run is a no-op.
    await ensureAllAdditiveTables(db);
    console.log(`${TAG} ${ADDITIVE_TABLE_NAMES.length} additive tables ensured.`);

    const res = await db.execute<{ table_name: string; column_name: string; is_nullable: string }>(
      sql`SELECT table_name, column_name, is_nullable
          FROM information_schema.columns
          WHERE table_schema = 'public'`
    );
    const rows = (Array.isArray(res) ? res : res.rows) as { table_name: string; column_name: string; is_nullable: string }[];
    const live: LiveColumn[] = rows.map((r) => ({
      table: r.table_name,
      column: r.column_name,
      isNullable: r.is_nullable === "YES",
    }));

    /**
     * Joined on the table as well as the constraint name. A constraint name is only unique per
     * table, and while two primary keys cannot collide (their backing indexes would), a FOREIGN KEY
     * creates no index and may reuse a primary key's name on another table. Joining on the name
     * alone then attributes that table's column to this key and reports drift that does not exist.
     */
    const pkRes = await db.execute<{ table_name: string; column_name: string }>(
      sql`SELECT tc.table_name, kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON kcu.constraint_name = tc.constraint_name
           AND kcu.constraint_schema = tc.constraint_schema
           AND kcu.table_schema = tc.table_schema
           AND kcu.table_name = tc.table_name
          WHERE tc.constraint_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'
          ORDER BY tc.table_name, kcu.ordinal_position`
    );
    const pkRows = (Array.isArray(pkRes) ? pkRes : pkRes.rows) as { table_name: string; column_name: string }[];
    const pkMap = new Map<string, string[]>();
    for (const r of pkRows) {
      const cols = pkMap.get(r.table_name);
      if (cols) cols.push(r.column_name);
      else pkMap.set(r.table_name, [r.column_name]);
    }
    const livePrimaryKeys: LivePrimaryKey[] = [...pkMap].map(([table, columns]) => ({ table, columns }));

    const expected = expectedTables();
    const problems = diffSchema(expected, live, livePrimaryKeys);

    if (problems.length === 0) {
      console.log(`${TAG} OK — ${expected.length} declared tables match the database.`);
      return;
    }
    console.error(`${TAG} schema drift: ${problems.length} problem(s). Nothing was altered.`);
    for (const p of problems) console.error(`${TAG}   - ${describeProblem(p)}`);
    console.error(
      `${TAG} Apply the change deliberately against this database, then redeploy. Do NOT wire drizzle-kit push into the deploy: it issues ALTER/DROP unattended and misreads PostgreSQL 17+ NOT NULL constraints.`
    );
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(`${TAG} failed:`, e instanceof Error ? e.message : e);
  process.exit(1);
});
