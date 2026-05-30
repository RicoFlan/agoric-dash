import type { EnrichedDisplay, DenomTableMeta } from "@/lib/metricsDisplayTypes";
import { resolveDenom } from "@/lib/resolveDenom";
import type { buildMetricsPayload } from "@/lib/metricsQuery";

export type { EnrichedDisplay } from "@/lib/metricsDisplayTypes";
export type MetricsApiPayload = Awaited<ReturnType<typeof buildMetricsPayload>>;

function collectTransferRelatedDenoms(p: MetricsApiPayload): Set<string> {
  const s = new Set<string>();
  for (const d of Object.keys(p.feePaidByDenom)) s.add(d);
  for (const d of Object.keys(p.feePaidByDenomPrevious)) s.add(d);
  for (const d of Object.keys(p.transferVolumeByDenom)) s.add(d);
  for (const d of Object.keys(p.bankCreditsVolumeByDenom ?? {})) s.add(d);
  for (const tv of p.series.transferVolumeSeries) {
    if (tv.denom) s.add(tv.denom);
  }
  for (const bc of p.series.bankCreditsVolumeSeries ?? []) {
    if (bc.denom) s.add(bc.denom);
  }
  for (const ibc of p.series.ibcAmountInSeries) {
    if (ibc.denom) s.add(ibc.denom);
  }
  for (const ibc of p.series.ibcAmountOutSeries) {
    if (ibc.denom) s.add(ibc.denom);
  }
  const offerValue = p.offers?.value;
  if (offerValue) {
    for (const d of Object.keys(offerValue.giveByDenom)) s.add(d);
    for (const d of Object.keys(offerValue.wantByDenom)) s.add(d);
    for (const d of Object.keys(offerValue.payoutByDenom)) s.add(d);
  }
  return s;
}

export function enrichMetricsForDisplay(p: MetricsApiPayload): EnrichedDisplay {
  const metas: Record<string, DenomTableMeta> = {};
  for (const denom of collectTransferRelatedDenoms(p)) {
    const m = resolveDenom(denom);
    if (m) {
      metas[denom] = { displaySymbol: m.displaySymbol, decimals: m.decimals };
    }
  }
  return { metas };
}
