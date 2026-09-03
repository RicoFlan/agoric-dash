/**
 * Idempotent CREATE TABLE IF NOT EXISTS for tables added after the original `db:push` baseline.
 * `drizzle/meta` is gitignored and production was created with push, so there is no migration
 * journal; additive tables are created on process start instead (see docs/DEVELOPMENT.md). Keep each
 * statement in sync with `schema.ts`. Never referenced by `scripts/reindexReset.ts`.
 */
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "./schema";

type Db = NodePgDatabase<typeof schema>;

export const OFFER_CATEGORY_PARTICIPANT_DAY_CREATE_SQL = `CREATE TABLE IF NOT EXISTS offer_category_participant_day (
  day date NOT NULL,
  address varchar(128) NOT NULL,
  category varchar(24) NOT NULL,
  PRIMARY KEY (day, address, category)
)`;

export async function ensureOfferCategoryParticipantDayTable(db: Db): Promise<void> {
  await db.execute(sql.raw(OFFER_CATEGORY_PARTICIPANT_DAY_CREATE_SQL));
}
