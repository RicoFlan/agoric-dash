/**
 * Persistence for `denom_price_day` (CoinGecko daily USD per coin id). Additive by construction:
 * the table is created with IF NOT EXISTS, writes are upserts keyed by (day, coingecko_id), and
 * nothing here deletes. Both the indexer process and CLI scripts pass their own drizzle instance.
 */
import { and, gte, inArray, lte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";

export type PriceDb = NodePgDatabase<typeof schema>;

export const DENOM_PRICE_DAY_CREATE_SQL = `CREATE TABLE IF NOT EXISTS denom_price_day (
  day date NOT NULL,
  coingecko_id varchar(128) NOT NULL,
  usd numeric(30, 12) NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, coingecko_id)
)`;

export interface DailyPriceRow {
  /** YYYY-MM-DD (UTC) */
  day: string;
  coingeckoId: string;
  usd: number;
}

/** Idempotent; safe to call on every process start. Mirrors `denomPriceDay` in schema.ts. */
export async function ensureDenomPriceDayTable(db: PriceDb): Promise<void> {
  await db.execute(sql.raw(DENOM_PRICE_DAY_CREATE_SQL));
}

const UPSERT_CHUNK = 500;

/** Upsert rows (latest fetch wins). Returns the number of rows written. */
export async function upsertDailyPrices(db: PriceDb, rows: DailyPriceRow[]): Promise<number> {
  const valid = rows.filter(
    (r) => /^\d{4}-\d{2}-\d{2}$/.test(r.day) && r.coingeckoId.length > 0 && Number.isFinite(r.usd) && r.usd >= 0
  );
  for (let i = 0; i < valid.length; i += UPSERT_CHUNK) {
    const chunk = valid.slice(i, i + UPSERT_CHUNK);
    await db
      .insert(schema.denomPriceDay)
      .values(chunk.map((r) => ({ day: r.day, coingeckoId: r.coingeckoId, usd: r.usd.toString() })))
      .onConflictDoUpdate({
        target: [schema.denomPriceDay.day, schema.denomPriceDay.coingeckoId],
        set: { usd: sql`excluded.usd`, fetchedAt: sql`now()` },
      });
  }
  return valid.length;
}

/** coingecko id → (day → usd) for the ids and inclusive day range. Empty ids → empty map (no query). */
export async function readDailyPrices(
  db: PriceDb,
  ids: string[],
  fromDay: string,
  toDay: string
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  const unique = [...new Set(ids.filter((id) => id.length > 0))];
  if (unique.length === 0) return out;
  const rows = await db
    .select({
      day: sql<string>`${schema.denomPriceDay.day}::text`,
      coingeckoId: schema.denomPriceDay.coingeckoId,
      usd: schema.denomPriceDay.usd,
    })
    .from(schema.denomPriceDay)
    .where(
      and(
        inArray(schema.denomPriceDay.coingeckoId, unique),
        gte(schema.denomPriceDay.day, fromDay),
        lte(schema.denomPriceDay.day, toDay)
      )
    );
  for (const r of rows) {
    const usd = Number(r.usd);
    if (!Number.isFinite(usd)) continue;
    let byDay = out.get(r.coingeckoId);
    if (!byDay) {
      byDay = new Map();
      out.set(r.coingeckoId, byDay);
    }
    byDay.set(r.day.slice(0, 10), usd);
  }
  return out;
}
