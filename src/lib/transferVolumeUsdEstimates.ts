import {
  type DailyPriceTable,
  type DayDenomAmounts,
  allDenoms,
  denomToCoinIdMap,
  priceDayDenomAmounts,
  type UsdPricingMeta,
} from "@/lib/denomPrices";
import type { EnrichedDisplay } from "@/lib/metricsDisplayTypes";

export type { UsdPricingMeta } from "@/lib/denomPrices";

/** Format dashboard USD notionals (day-priced gross flow); not accounting-grade. */
export function formatUsdEstimate(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  const opts: Intl.NumberFormatOptions =
    n >= 1e9
      ? { maximumFractionDigits: 0 }
      : n >= 1e6
        ? { maximumFractionDigits: 1 }
        : n >= 1
          ? { maximumFractionDigits: 2 }
          : { maximumFractionDigits: 4 };
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", ...opts }).format(n);
}

/** Price a day→denom map and format cells; null cells for denoms with no priced day. */
export function formattedUsdCells(
  byDayDenom: DayDenomAmounts,
  display: EnrichedDisplay,
  table: DailyPriceTable,
  denomToCoinId?: Map<string, string>
): { byDenom: Record<string, string | null>; total: string | null; meta: UsdPricingMeta } {
  const pricer = table.pricer();
  const r = priceDayDenomAmounts(byDayDenom, display, pricer, denomToCoinId);
  const byDenom: Record<string, string | null> = {};
  for (const [denom, v] of Object.entries(r.usdByDenom)) byDenom[denom] = v === null ? null : formatUsdEstimate(v);
  return { byDenom, total: r.total === null ? null : formatUsdEstimate(r.total), meta: pricer.meta() };
}

/**
 * USD cells for the Value handled table: each denom's native amount on each UTC day is priced at
 * that day's `denom_price_day` row (spot only for days with no row). Populates **USD gross** and
 * **USD credits** cells and separate footer totals; the two columns remain non-additive. One
 * `usdPricingMeta` covers both columns (same table, same basis).
 */
export function enrichTransferAndBankCreditsUsdEstimates(
  transferVolumeByDayDenom: DayDenomAmounts,
  bankCreditsByDayDenom: DayDenomAmounts,
  display: EnrichedDisplay,
  table: DailyPriceTable
): {
  transferVolumeUsdByDenom: Record<string, string | null>;
  transferVolumeUsdTotal: string | null;
  bankCreditsVolumeUsdByDenom: Record<string, string | null>;
  bankCreditsVolumeUsdTotal: string | null;
  usdPricingMeta: UsdPricingMeta;
} {
  const denomToCoinId = denomToCoinIdMap(
    new Set([...allDenoms(transferVolumeByDayDenom), ...allDenoms(bankCreditsByDayDenom)])
  );
  const pricer = table.pricer();
  const transfer = priceDayDenomAmounts(transferVolumeByDayDenom, display, pricer, denomToCoinId);
  const bankCredits = priceDayDenomAmounts(bankCreditsByDayDenom, display, pricer, denomToCoinId);
  const fmt = (m: Record<string, number | null>) =>
    Object.fromEntries(Object.entries(m).map(([d, v]) => [d, v === null ? null : formatUsdEstimate(v)]));
  return {
    transferVolumeUsdByDenom: fmt(transfer.usdByDenom),
    transferVolumeUsdTotal: transfer.total === null ? null : formatUsdEstimate(transfer.total),
    bankCreditsVolumeUsdByDenom: fmt(bankCredits.usdByDenom),
    bankCreditsVolumeUsdTotal: bankCredits.total === null ? null : formatUsdEstimate(bankCredits.total),
    usdPricingMeta: pricer.meta(),
  };
}
