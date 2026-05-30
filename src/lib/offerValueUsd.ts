/**
 * USD valuation of offer give/want/payout native totals, reusing the same denom-keyed CoinGecko spot
 * pricing as the Value handled table (current spot × range native total — a dashboard notional, not
 * accounting-grade, and gross flow rather than net). One price fetch covers the union of all three
 * maps so offers do not add extra price-API round trips per map.
 *
 * Only vbank-recognized denoms (mapped from offer leg brands at index time) reach here; unmapped
 * brands were dropped by the indexer. A denom with no CoinGecko id or no known decimals yields a null
 * USD cell rather than a wrong number.
 */
import { atomicToFloat } from "@/lib/amountFormat";
import { getUsdSpotPrices } from "@/lib/coingecko/simplePrice";
import { resolveCoinGeckoId } from "@/lib/coingecko/resolveCoinGeckoId";
import { formatUsdEstimate, type UsdPricingMeta } from "@/lib/transferVolumeUsdEstimates";
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

function usdCells(
  byDenomAtomic: Record<string, string>,
  display: EnrichedDisplay,
  usdByCoinId: Record<string, number>,
  denomToCoinId: Map<string, string>
): OfferValueUsdLeg {
  const byDenom: Record<string, string | null> = {};
  let sum = 0;
  let priced = 0;
  for (const denom of Object.keys(byDenomAtomic)) {
    const coinId = denomToCoinId.get(denom);
    const px = coinId ? usdByCoinId[coinId] : undefined;
    const dec = display.metas[denom]?.decimals;
    if (typeof px !== "number" || !Number.isFinite(px) || typeof dec !== "number" || dec < 0) {
      byDenom[denom] = null;
      continue;
    }
    const lineUsd = atomicToFloat(byDenomAtomic[denom]!, dec) * px;
    if (Number.isFinite(lineUsd) && lineUsd >= 0) {
      sum += lineUsd;
      priced += 1;
      byDenom[denom] = formatUsdEstimate(lineUsd);
    } else {
      byDenom[denom] = null;
    }
  }
  return { byDenom, total: priced > 0 ? formatUsdEstimate(sum) : null };
}

export async function enrichOfferValueUsd(
  giveByDenom: Record<string, string>,
  wantByDenom: Record<string, string>,
  payoutByDenom: Record<string, string>,
  display: EnrichedDisplay
): Promise<OfferValueUsd> {
  const denomToCoinId = new Map<string, string>();
  const ids: string[] = [];
  for (const denom of new Set([
    ...Object.keys(giveByDenom),
    ...Object.keys(wantByDenom),
    ...Object.keys(payoutByDenom),
  ])) {
    const id = resolveCoinGeckoId(denom);
    if (id) {
      denomToCoinId.set(denom, id);
      ids.push(id);
    }
  }

  let usdByCoinId: Record<string, number> = {};
  let fetchedAtIso: string | null = null;
  let partialOrStale = false;
  try {
    const r = await getUsdSpotPrices(ids);
    usdByCoinId = r.usdByCoinId;
    fetchedAtIso = r.fetchedAtIso;
    partialOrStale = r.partialOrStale;
  } catch {
    partialOrStale = true;
  }

  return {
    give: usdCells(giveByDenom, display, usdByCoinId, denomToCoinId),
    want: usdCells(wantByDenom, display, usdByCoinId, denomToCoinId),
    payouts: usdCells(payoutByDenom, display, usdByCoinId, denomToCoinId),
    usdPricingMeta: { source: "coingecko", spotFetchedAt: fetchedAtIso, partialOrStale },
  };
}
