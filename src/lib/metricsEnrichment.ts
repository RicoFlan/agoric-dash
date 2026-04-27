import { fetchCoingeckoUsdByIds } from "@/lib/coinGecko";
import type { EnrichedDisplay, DenomTableMeta } from "@/lib/metricsDisplayTypes";
import { resolveDenom } from "@/lib/resolveDenom";
import type { buildMetricsPayload } from "@/lib/metricsQuery";

export type { EnrichedDisplay } from "@/lib/metricsDisplayTypes";
export type MetricsApiPayload = Awaited<ReturnType<typeof buildMetricsPayload>>;

/** Coingecko only for optional USD hints on in-tx / IBC transfer views — not for fees. */
function collectTransferRelatedDenoms(p: MetricsApiPayload): Set<string> {
  const s = new Set<string>();
  for (const d of Object.keys(p.feePaidByDenom)) s.add(d);
  for (const d of Object.keys(p.feePaidByDenomPrevious)) s.add(d);
  for (const d of Object.keys(p.transferVolumeByDenom)) s.add(d);
  for (const x of [p.series.transferValueTop1, p.series.transferValueTop2, p.series.ibcValueIn]) {
    if (x && "denom" in x && x.denom) s.add(x.denom);
  }
  if (p.series.ibcValueOut?.denom) s.add(p.series.ibcValueOut.denom);
  return s;
}

function buildMetas(denoms: Iterable<string>): {
  metas: Record<string, DenomTableMeta>;
  coingeckoIds: string[];
} {
  const metas: Record<string, DenomTableMeta> = {};
  const idSet = new Set<string>();
  for (const denom of denoms) {
    const m = resolveDenom(denom);
    if (m) {
      metas[denom] = m;
      if (m.coingeckoId) idSet.add(m.coingeckoId);
    }
  }
  return { metas, coingeckoIds: [...idSet] };
}

export async function enrichMetricsForDisplay(
  p: MetricsApiPayload
): Promise<EnrichedDisplay> {
  const { metas, coingeckoIds } = buildMetas(collectTransferRelatedDenoms(p));
  let usd: Record<string, number> = {};
  let pricingFromCoinGecko = false;
  if (coingeckoIds.length > 0) {
    try {
      usd = await fetchCoingeckoUsdByIds(coingeckoIds);
      pricingFromCoinGecko = Object.keys(usd).length > 0;
    } catch (e) {
      console.warn("CoinGecko fetch failed", e);
    }
  }
  return { usd, metas, pricingFromCoinGecko };
}
