/**
 * Build the request's `DailyPriceTable` from Postgres. Kept apart from denomPrices.ts so the pricing
 * math stays DB-free for tests. A missing `denom_price_day` table (before the first backfill or
 * indexer start) degrades to an empty table → every id falls back to spot, and the meta says so.
 */
import { db } from "@/db/client";
import { readDailyPrices } from "@/lib/coingecko/priceStore";
import { DailyPriceTable } from "@/lib/denomPrices";

let warnedMissingTable = false;

export async function loadDailyPriceTable(
  fromDay: string,
  toDay: string,
  coingeckoIds: Iterable<string>
): Promise<DailyPriceTable> {
  const ids = [...new Set(coingeckoIds)];
  let byId = new Map<string, Map<string, number>>();
  try {
    byId = await readDailyPrices(db, ids, fromDay, toDay);
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "42P01") {
      if (!warnedMissingTable) {
        warnedMissingTable = true;
        console.warn("[denomPrices] denom_price_day does not exist yet — run `npm run backfill:prices`; using spot for all USD");
      }
    } else {
      console.warn("[denomPrices] read failed; using spot fallback", e);
    }
  }
  const table = new DailyPriceTable(byId, fromDay, toDay);
  await table.ensureSpot(ids);
  return table;
}
