import { atomicToFloat } from "@/lib/amountFormat";
import { getUsdSpotPrices } from "@/lib/coingecko/simplePrice";
import { resolveCoinGeckoId } from "@/lib/coingecko/resolveCoinGeckoId";
import { topNShare } from "@/lib/concentrationMath";
import type { EnrichedDisplay } from "@/lib/metricsDisplayTypes";
import { queryAddressVolumeTotals, queryParticipationRange } from "@/lib/participationQueries";

const TOP_N = 10;

function buildDenomToCoinId(denoms: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const d of denoms) {
    const id = resolveCoinGeckoId(d);
    if (id) m.set(d, id);
  }
  return m;
}

function usdLineFromAtomic(
  atomic: string,
  denom: string,
  display: EnrichedDisplay,
  usdByCoinId: Record<string, number>,
  denomToCoinId: Map<string, string>
): number {
  const id = denomToCoinId.get(denom);
  if (!id) return 0;
  const px = usdByCoinId[id];
  if (typeof px !== "number" || !Number.isFinite(px)) return 0;
  const dec = display.metas[denom]?.decimals;
  if (typeof dec !== "number" || !Number.isFinite(dec) || dec < 0) return 0;
  const human = atomicToFloat(atomic, dec);
  const u = human * px;
  return Number.isFinite(u) && u >= 0 ? u : 0;
}

function addressTotalsUsd(
  byAddrDenom: Map<string, Map<string, bigint>>,
  display: EnrichedDisplay,
  usdByCoinId: Record<string, number>,
  denomToCoinId: Map<string, string>
): number[] {
  const totals: number[] = [];
  for (const [, denoms] of byAddrDenom) {
    let u = 0;
    for (const [d, atomic] of denoms) {
      u += usdLineFromAtomic(atomic.toString(), d, display, usdByCoinId, denomToCoinId);
    }
    if (u > 0) totals.push(u);
  }
  return totals.sort((a, b) => b - a);
}

export type ParticipationConcentrationPackage = {
  participation: {
    distinctSigners: string;
    distinctFeePayers: string;
    /** Addresses active on exactly one calendar day within the range (any signer/fee-payer role). */
    singleDayInRange: string;
    /** Addresses active on 2+ calendar days within the range. */
    multiDayInRange: string;
    distinctUnionPerDay: { day: string; count: string }[];
  };
  concentration: {
    /** Share of gross-movement USD (EST) from top 10 addresses (sender-side indexed legs). */
    top10AddressShareGrossUsd: string | null;
  };
};

export async function enrichParticipationAndConcentration(
  fromDay: string,
  toDay: string,
  transferVolumeByDenom: Record<string, string>,
  display: EnrichedDisplay
): Promise<ParticipationConcentrationPackage> {
  const [participation, volumeByAddressDenom] = await Promise.all([
    queryParticipationRange(fromDay, toDay),
    queryAddressVolumeTotals(fromDay, toDay),
  ]);

  const denomSet = new Set<string>(Object.keys(transferVolumeByDenom));
  for (const [, byDenom] of volumeByAddressDenom) {
    for (const d of byDenom.keys()) denomSet.add(d);
  }
  const denoms = [...denomSet];
  const denomToCoinId = buildDenomToCoinId(denoms);
  const ids = [...new Set([...denomToCoinId.values()])];
  let usdByCoinId: Record<string, number> = {};
  try {
    const r = await getUsdSpotPrices(ids);
    usdByCoinId = r.usdByCoinId;
  } catch {
    /* partialOrStale handled implicitly — zeros suppress concentration */
  }

  const volTotals = addressTotalsUsd(
    volumeByAddressDenom,
    display,
    usdByCoinId,
    denomToCoinId
  );

  const topVol = topNShare(volTotals, TOP_N);

  const fmtPct = (x: number | null) =>
    x === null ? null : `${(x * 100).toFixed(1)}%`;

  return {
    participation: {
      distinctSigners: String(participation.distinctSigners),
      distinctFeePayers: String(participation.distinctFeePayers),
      singleDayInRange: String(participation.singleDayAddresses),
      multiDayInRange: String(participation.multiDayAddresses),
      distinctUnionPerDay: participation.distinctUnionPerDay.map((r) => ({
        day: r.day,
        count: String(r.count),
      })),
    },
    concentration: {
      top10AddressShareGrossUsd: fmtPct(topVol),
    },
  };
}
