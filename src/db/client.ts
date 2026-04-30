import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  /** Fail fast instead of hanging /api/metrics when Postgres is down or misconfigured. */
  connectionTimeoutMillis: 15_000,
  idleTimeoutMillis: 30_000,
});

export const db = drizzle(pool, { schema });
export { pool };
