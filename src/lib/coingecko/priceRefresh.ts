/**
 * Shared "fetch N days of history for every configured coin id and upsert" routine. The backfill
 * script runs it once with 365 days; the indexer runs it periodically with a few days so today's
 * 00:00 UTC point lands without a manual step. Serial requests with a delay keep the Demo tier's
 * ~30 req/min budget; a failing id never aborts the run.
 */
import { allConfiguredCoinGeckoIds } from "@/lib/coingecko/resolveCoinGeckoId";
import { fetchMarketChartDailyUsd } from "@/lib/coingecko/marketChart";
import { ensureDenomPriceDayTable, upsertDailyPrices, type PriceDb } from "@/lib/coingecko/priceStore";

export interface RefreshDailyPricesOptions {
  /** History depth per id (1–365). */
  days: number;
  /** Restrict to these ids (default: every configured id). */
  ids?: string[];
  /** Pause between requests (default 2500 ms ≈ 24 req/min). */
  delayMs?: number;
  log?: (line: string) => void;
}

export interface RefreshDailyPricesSummary {
  idsAttempted: number;
  idsOk: number;
  idsNotFound: string[];
  idsFailed: string[];
  rowsUpserted: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

export async function refreshDailyPrices(
  db: PriceDb,
  opts: RefreshDailyPricesOptions
): Promise<RefreshDailyPricesSummary> {
  const log = opts.log ?? (() => {});
  const ids = (opts.ids && opts.ids.length > 0 ? opts.ids : allConfiguredCoinGeckoIds()).filter((s) => s.length > 0);
  const delayMs = opts.delayMs ?? 2500;
  const summary: RefreshDailyPricesSummary = {
    idsAttempted: ids.length,
    idsOk: 0,
    idsNotFound: [],
    idsFailed: [],
    rowsUpserted: 0,
  };

  await ensureDenomPriceDayTable(db);

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const r = await fetchMarketChartDailyUsd(id, opts.days);
    if (r.status === "ok") {
      const n = await upsertDailyPrices(
        db,
        r.rows.map((row) => ({ day: row.day, coingeckoId: id, usd: row.usd }))
      );
      summary.idsOk += 1;
      summary.rowsUpserted += n;
      log(`[prices] ${id}: ${n} day rows (${r.rows[0]?.day ?? "—"} … ${r.rows[r.rows.length - 1]?.day ?? "—"})`);
    } else if (r.status === "not_found") {
      summary.idsNotFound.push(id);
      log(`[prices] ${id}: not found on CoinGecko (check coingeckoDisplaySymbolToId.json)`);
    } else {
      summary.idsFailed.push(id);
      log(`[prices] ${id}: ${r.status} ${r.detail ?? ""}`.trim());
    }
    if (i < ids.length - 1) await sleep(delayMs);
  }

  return summary;
}
