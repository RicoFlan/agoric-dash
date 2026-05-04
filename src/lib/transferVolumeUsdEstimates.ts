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

export async function enrichTransferVolumeUsdEstimates(
  transferVolumeByDenom: Record<string, string>,
  display: EnrichedDisplay
): Promise<{
  transferVolumeUsdByDenom: Record<string, string | null>;
  /** Sum of per-denom USD estimates (priced rows only); same basis as the column. */
  transferVolumeUsdTotal: string | null;
  usdPricingMeta: UsdPricingMeta;
}> {
  const denoms = Object.keys(transferVolumeByDenom);
  const denomToCoinId = new Map<string, string>();
  const ids: string[] = [];

  for (const d of denoms) {
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

  const transferVolumeUsdByDenom: Record<string, string | null> = {};
  let sumUsd = 0;
  let pricedRows = 0;

  for (const d of denoms) {
    const coinId = denomToCoinId.get(d);
    if (!coinId) {
      transferVolumeUsdByDenom[d] = null;
      continue;
    }
    const px = usdByCoinId[coinId];
    if (typeof px !== "number" || !Number.isFinite(px)) {
      transferVolumeUsdByDenom[d] = null;
      continue;
    }
    const dec = display.metas[d]?.decimals;
    if (typeof dec !== "number" || !Number.isFinite(dec) || dec < 0) {
      transferVolumeUsdByDenom[d] = null;
      continue;
    }
    const atomic = transferVolumeByDenom[d];
    const human = atomicToFloat(atomic, dec);
    const lineUsd = human * px;
    if (Number.isFinite(lineUsd) && lineUsd >= 0) {
      sumUsd += lineUsd;
      pricedRows += 1;
    }
    transferVolumeUsdByDenom[d] = formatUsdEstimate(lineUsd);
  }

  const transferVolumeUsdTotal = pricedRows > 0 ? formatUsdEstimate(sumUsd) : null;

  return {
    transferVolumeUsdByDenom,
    transferVolumeUsdTotal,
    usdPricingMeta: {
      source: "coingecko",
      spotFetchedAt: fetchedAtIso,
      partialOrStale,
    },
  };
}
