/**
 * USD valuation of offer give/want/payout native amounts on the same day-accurate basis as the Value
 * handled table: each day's atomic total per vbank denom × that day's `denom_price_day` row (spot only
 * for days with no row). Gross flow, not net; give/want/payouts overlap and are not additive.
 *
 * Only vbank-recognized denoms (mapped from offer leg brands at index time) reach here; unmapped
 * brands were dropped by the indexer. A denom with no CoinGecko id, no known decimals, or no price on
 * any of its days yields a null USD cell rather than a wrong number.
 */
import {
  type DailyPriceTable,
  type DayDenomAmounts,
  allDenoms,
  denomToCoinIdMap,
  priceDayDenomAmounts,
  type UsdPricingMeta,
} from "@/lib/denomPrices";
import { formatUsdEstimate } from "@/lib/transferVolumeUsdEstimates";
import type { EnrichedDisplay } from "@/lib/metricsDisplayTypes";

export interface OfferValueUsdLeg {
  byDenom: Record<string, string | null>;
  total: string | null;
}

export interface OfferValueUsd {
  give: OfferValueUsdLeg;
  want: OfferValueUsdLeg;
  payouts: OfferValueUsdLeg;
  usdPricingMeta: UsdPricingMeta;
}

export function enrichOfferValueUsd(
  giveByDayDenom: DayDenomAmounts,
  wantByDayDenom: DayDenomAmounts,
  payoutByDayDenom: DayDenomAmounts,
  display: EnrichedDisplay,
  table: DailyPriceTable
): OfferValueUsd {
  const denomToCoinId = denomToCoinIdMap(
    new Set([...allDenoms(giveByDayDenom), ...allDenoms(wantByDayDenom), ...allDenoms(payoutByDayDenom)])
  );
  const pricer = table.pricer();
  const leg = (byDay: DayDenomAmounts): OfferValueUsdLeg => {
    const r = priceDayDenomAmounts(byDay, display, pricer, denomToCoinId);
    const byDenom: Record<string, string | null> = {};
    for (const [d, v] of Object.entries(r.usdByDenom)) byDenom[d] = v === null ? null : formatUsdEstimate(v);
    return { byDenom, total: r.total === null ? null : formatUsdEstimate(r.total) };
  };
  return {
    give: leg(giveByDayDenom),
    want: leg(wantByDayDenom),
    payouts: leg(payoutByDayDenom),
    usdPricingMeta: pricer.meta(),
  };
}
