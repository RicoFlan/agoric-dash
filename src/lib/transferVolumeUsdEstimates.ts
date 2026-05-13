import { atomicToFloat } from "@/lib/amountFormat";
import { getUsdSpotPrices } from "@/lib/coingecko/simplePrice";
import { resolveCoinGeckoId } from "@/lib/coingecko/resolveCoinGeckoId";
import type { EnrichedDisplay } from "@/lib/metricsDisplayTypes";

export type UsdPricingMeta = {
  source: "coingecko";
  spotFetchedAt: string | null;
  partialOrStale: boolean;
};

/** Format dashboard USD notionals (spot × range total); not accounting-grade. */
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

function usdCellsForDenomTotals(
  volumeByDenom: Record<string, string>,
  display: EnrichedDisplay,
  usdByCoinId: Record<string, number>,
  denomToCoinId: Map<string, string>
): { byDenom: Record<string, string | null>; total: string | null } {
  const denoms = Object.keys(volumeByDenom);
  const byDenom: Record<string, string | null> = {};
  let sumUsd = 0;
  let pricedRows = 0;

  for (const d of denoms) {
    const coinId = denomToCoinId.get(d);
    if (!coinId) {
      byDenom[d] = null;
      continue;
    }
    const px = usdByCoinId[coinId];
    if (typeof px !== "number" || !Number.isFinite(px)) {
      byDenom[d] = null;
      continue;
    }
    const dec = display.metas[d]?.decimals;
    if (typeof dec !== "number" || !Number.isFinite(dec) || dec < 0) {
      byDenom[d] = null;
      continue;
    }
    const atomic = volumeByDenom[d];
    const human = atomicToFloat(atomic, dec);
    const lineUsd = human * px;
    if (Number.isFinite(lineUsd) && lineUsd >= 0) {
      sumUsd += lineUsd;
      pricedRows += 1;
    }
    byDenom[d] = formatUsdEstimate(lineUsd);
  }

  return { byDenom, total: pricedRows > 0 ? formatUsdEstimate(sumUsd) : null };
}

/**
 * One CoinGecko fetch for the union of denoms in both maps — used by `/api/metrics` so bank-credits
 * rows do not double-hit the price API.
 */
export async function enrichTransferAndBankCreditsUsdEstimates(
  transferVolumeByDenom: Record<string, string>,
  bankCreditsVolumeByDenom: Record<string, string>,
  display: EnrichedDisplay
): Promise<{
  transferVolumeUsdByDenom: Record<string, string | null>;
  transferVolumeUsdTotal: string | null;
  bankCreditsVolumeUsdByDenom: Record<string, string | null>;
  bankCreditsVolumeUsdTotal: string | null;
  usdPricingMeta: UsdPricingMeta;
}> {
  const denomSet = new Set<string>([
    ...Object.keys(transferVolumeByDenom),
    ...Object.keys(bankCreditsVolumeByDenom),
  ]);
  const denomToCoinId = new Map<string, string>();
  const ids: string[] = [];

  for (const d of denomSet) {
    const id = resolveCoinGeckoId(d);
    if (id) {
      denomToCoinId.set(d, id);
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

  const transfer = usdCellsForDenomTotals(transferVolumeByDenom, display, usdByCoinId, denomToCoinId);
  const bankCredits = usdCellsForDenomTotals(bankCreditsVolumeByDenom, display, usdByCoinId, denomToCoinId);

  return {
    transferVolumeUsdByDenom: transfer.byDenom,
    transferVolumeUsdTotal: transfer.total,
    bankCreditsVolumeUsdByDenom: bankCredits.byDenom,
    bankCreditsVolumeUsdTotal: bankCredits.total,
    usdPricingMeta: {
      source: "coingecko",
      spotFetchedAt: fetchedAtIso,
      partialOrStale,
    },
  };
}

export async function enrichTransferVolumeUsdEstimates(
  transferVolumeByDenom: Record<string, string>,
  display: EnrichedDisplay
): Promise<{
  transferVolumeUsdByDenom: Record<string, string | null>;
  /** Sum of per-denom USD estimates (priced rows only); same basis as the column. */
  transferVolumeUsdTotal: string | null;
  usdPricingMeta: UsdPricingMeta;
}> {
  const r = await enrichTransferAndBankCreditsUsdEstimates(transferVolumeByDenom, {}, display);
  return {
    transferVolumeUsdByDenom: r.transferVolumeUsdByDenom,
    transferVolumeUsdTotal: r.transferVolumeUsdTotal,
    usdPricingMeta: r.usdPricingMeta,
  };
}
