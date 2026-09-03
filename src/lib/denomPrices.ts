/**
 * Read-time USD pricing on a day-accurate basis. A `DailyPriceTable` holds `denom_price_day` rows
 * for the request's calendar range plus spot fallback for ids that are missing at least one day in
 * range (normally just today, before the indexer's refresh has run). Each USD section of the payload
 * prices through its own `UsdPricer`, which counts how many (denom, day) amounts came from rows vs
 * spot vs nothing and reports that as `UsdPricingMeta` — so the UI can say what basis a figure has.
 */
import { atomicToFloat } from "@/lib/amountFormat";
import { getUsdSpotPrices } from "@/lib/coingecko/simplePrice";
import { resolveCoinGeckoId } from "@/lib/coingecko/resolveCoinGeckoId";
import type { EnrichedDisplay } from "@/lib/metricsDisplayTypes";

export type UsdPriceBasis = "daily-close" | "spot-fallback";

export type UsdPricingMeta = {
  source: "coingecko";
  /** Overall basis of the figures priced through this pricer: all rows, all spot, both, or nothing priced. */
  basis: "daily-close" | "spot-fallback" | "mixed" | "none";
  /** (denom, day) amounts priced from `denom_price_day`. */
  pricedDays: number;
  /** (denom, day) amounts priced at spot because the day had no row. */
  spotFallbackDays: number;
  /** (denom, day) amounts with a coin id but no price at all. */
  unpricedDays: number;
  spotFetchedAt: string | null;
  /** Spot fetch was rate-limited or failed — some fallback cells may be missing. */
  partialOrStale: boolean;
};

/** Every UTC calendar day from `fromDay` through `toDay` inclusive (YYYY-MM-DD); empty if inverted. */
export function utcDaysInclusive(fromDay: string, toDay: string): string[] {
  const start = new Date(`${fromDay.slice(0, 10)}T00:00:00.000Z`);
  const end = new Date(`${toDay.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
  const out: string[] = [];
  for (const d = new Date(start); d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Shared price data for one request: day rows + lazily fetched spot for gaps. */
export class DailyPriceTable {
  private spot: Record<string, number> = {};
  private spotChecked = new Set<string>();
  spotFetchedAt: string | null = null;
  partialOrStale = false;
  /** Days in range that can have a price (never later than today UTC). */
  private readonly coverageDays: string[];

  constructor(
    private readonly byId: Map<string, Map<string, number>>,
    fromDay: string,
    toDay: string,
    todayUtc: string = new Date().toISOString().slice(0, 10)
  ) {
    const end = toDay.slice(0, 10) < todayUtc ? toDay.slice(0, 10) : todayUtc;
    this.coverageDays = utcDaysInclusive(fromDay, end);
  }

  /** Ids with at least one coverage day lacking a row (candidates for spot fallback). */
  idsMissingAnyDay(ids: Iterable<string>): string[] {
    const out: string[] = [];
    for (const id of new Set(ids)) {
      const byDay = this.byId.get(id);
      if (!byDay || this.coverageDays.some((d) => !byDay.has(d))) out.push(id);
    }
    return out;
  }

  /** Fetch spot once for ids that have gaps; ids already checked are skipped. Never throws. */
  async ensureSpot(ids: Iterable<string>): Promise<void> {
    const need = this.idsMissingAnyDay(ids).filter((id) => !this.spotChecked.has(id));
    for (const id of need) this.spotChecked.add(id);
    if (need.length === 0) return;
    try {
      const r = await getUsdSpotPrices(need);
      Object.assign(this.spot, r.usdByCoinId);
      if (r.fetchedAtIso) this.spotFetchedAt = r.fetchedAtIso;
      if (r.partialOrStale) this.partialOrStale = true;
    } catch {
      this.partialOrStale = true;
    }
  }

  /** Price for `id` on `day` (YYYY-MM-DD): the day's row, else spot, else null. Does not count. */
  lookup(id: string, day: string): { usd: number; basis: UsdPriceBasis } | null {
    const row = this.byId.get(id)?.get(day.slice(0, 10));
    if (typeof row === "number" && Number.isFinite(row)) return { usd: row, basis: "daily-close" };
    const s = this.spot[id];
    if (typeof s === "number" && Number.isFinite(s)) return { usd: s, basis: "spot-fallback" };
    return null;
  }

  /** A fresh counter over this table — one per payload section so each reports its own basis. */
  pricer(): UsdPricer {
    return new UsdPricer(this);
  }
}

export class UsdPricer {
  private hitsTable = 0;
  private hitsSpot = 0;
  private misses = 0;

  constructor(readonly table: DailyPriceTable) {}

  price(id: string, day: string): { usd: number; basis: UsdPriceBasis } | null {
    const p = this.table.lookup(id, day);
    if (!p) this.misses += 1;
    else if (p.basis === "daily-close") this.hitsTable += 1;
    else this.hitsSpot += 1;
    return p;
  }

  meta(): UsdPricingMeta {
    const basis: UsdPricingMeta["basis"] =
      this.hitsTable > 0 && this.hitsSpot > 0
        ? "mixed"
        : this.hitsTable > 0
          ? "daily-close"
          : this.hitsSpot > 0
            ? "spot-fallback"
            : "none";
    return {
      source: "coingecko",
      basis,
      pricedDays: this.hitsTable,
      spotFallbackDays: this.hitsSpot,
      unpricedDays: this.misses,
      spotFetchedAt: this.table.spotFetchedAt,
      partialOrStale: this.table.partialOrStale,
    };
  }
}

/** Denom → CoinGecko id for the denoms that resolve; unmapped denoms are absent. */
export function denomToCoinIdMap(denoms: Iterable<string>): Map<string, string> {
  const m = new Map<string, string>();
  for (const d of denoms) {
    const id = resolveCoinGeckoId(d);
    if (id) m.set(d, id);
  }
  return m;
}

/** day → denom → atomic amount, the shape every USD enrichment prices from. */
export type DayDenomAmounts = Map<string, Map<string, bigint>>;

export function allDenoms(byDayDenom: DayDenomAmounts): Set<string> {
  const s = new Set<string>();
  for (const byDenom of byDayDenom.values()) for (const d of byDenom.keys()) s.add(d);
  return s;
}

/**
 * USD for one (denom, day, atomic) leg, or null when the denom is unmapped, has no decimals, or has
 * no price that day. Zero amounts are 0 without touching the pricer's counters.
 */
export function usdForLeg(
  denom: string,
  day: string,
  atomic: bigint | string,
  display: EnrichedDisplay,
  denomToCoinId: Map<string, string>,
  pricer: UsdPricer
): number | null {
  const id = denomToCoinId.get(denom);
  if (!id) return null;
  const dec = display.metas[denom]?.decimals;
  if (typeof dec !== "number" || !Number.isFinite(dec) || dec < 0) return null;
  const atomicStr = typeof atomic === "bigint" ? atomic.toString() : atomic;
  if (atomicStr === "0") return 0;
  const p = pricer.price(id, day);
  if (!p) return null;
  const u = atomicToFloat(atomicStr, dec) * p.usd;
  return Number.isFinite(u) && u >= 0 ? u : null;
}

/**
 * Sum day-priced legs per denom. A denom's cell is null only when none of its days could be priced
 * (unmapped, no decimals, or no price on any day); partially priced denoms sum the priced days and
 * the shortfall shows in `pricer.meta().unpricedDays`. `total` sums priced denoms, null if none.
 */
export function priceDayDenomAmounts(
  byDayDenom: DayDenomAmounts,
  display: EnrichedDisplay,
  pricer: UsdPricer,
  denomToCoinId: Map<string, string> = denomToCoinIdMap(allDenoms(byDayDenom))
): { usdByDenom: Record<string, number | null>; total: number | null } {
  const sums = new Map<string, number>();
  const seen = new Set<string>();
  for (const [day, byDenom] of byDayDenom) {
    for (const [denom, atomic] of byDenom) {
      seen.add(denom);
      const u = usdForLeg(denom, day, atomic, display, denomToCoinId, pricer);
      if (u === null) continue;
      sums.set(denom, (sums.get(denom) ?? 0) + u);
    }
  }
  const usdByDenom: Record<string, number | null> = {};
  let total = 0;
  let priced = 0;
  for (const denom of seen) {
    const v = sums.get(denom);
    if (typeof v === "number") {
      usdByDenom[denom] = v;
      total += v;
      priced += 1;
    } else {
      usdByDenom[denom] = null;
    }
  }
  return { usdByDenom, total: priced > 0 ? total : null };
}
