import { atomicToFloat } from "@/lib/amountFormat";
import { getUsdSpotPrices } from "@/lib/coingecko/simplePrice";
import { resolveCoinGeckoId } from "@/lib/coingecko/resolveCoinGeckoId";
import {
  buildConcentrationSummary,
  formatHhi,
  formatSharePct,
} from "@/lib/concentrationSummary";
import {
  buildConcentrationOverTime,
  type ConcentrationTimePoint,
} from "@/lib/concentrationTimeseries";
import { distinctSendersByDenom } from "@/lib/distinctSenders";
import type { EnrichedDisplay } from "@/lib/metricsDisplayTypes";
import {
  queryAddressFeeTotals,
  queryAddressFeeTotalsByDay,
  queryAddressVolumeTotals,
  queryAddressVolumeTotalsByDay,
  queryParticipationRange,
} from "@/lib/participationQueries";

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
    /** Share of paid-fee USD (EST) from the top 10 fee payers. */
    top10AddressShareFeesUsd: string | null;
    /** Herfindahl–Hirschman index (0–1) of gross-movement USD across addresses. */
    grossUsdHhi: string | null;
    /** Herfindahl–Hirschman index (0–1) of paid-fee USD across fee payers. */
    feesUsdHhi: string | null;
  };
  /** Distinct sending addresses per denom (range) — wash/overcounting guardrail for gross volume. */
  distinctSendersByDenom: Record<string, number>;
  /** Daily concentration trend (HHI + top-10 share) for gross-movement USD and paid-fee USD. */
  concentrationOverTime: ConcentrationTimePoint[];
};

/** Price each day's per-address denom totals into a day → USD-totals[] map for the concentration trend. */
function addressTotalsUsdByDay(
  byDayAddrDenom: Map<string, Map<string, Map<string, bigint>>>,
  display: EnrichedDisplay,
  usdByCoinId: Record<string, number>,
  denomToCoinId: Map<string, string>
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const [day, byAddrDenom] of byDayAddrDenom) {
    out.set(day, addressTotalsUsd(byAddrDenom, display, usdByCoinId, denomToCoinId));
  }
  return out;
}

export async function enrichParticipationAndConcentration(
  fromDay: string,
  toDay: string,
  transferVolumeByDenom: Record<string, string>,
  display: EnrichedDisplay
): Promise<ParticipationConcentrationPackage> {
  const [
    participation,
    volumeByAddressDenom,
    feeByAddressDenom,
    volumeByDayAddressDenom,
    feeByDayAddressDenom,
  ] = await Promise.all([
    queryParticipationRange(fromDay, toDay),
    queryAddressVolumeTotals(fromDay, toDay),
    queryAddressFeeTotals(fromDay, toDay),
    queryAddressVolumeTotalsByDay(fromDay, toDay),
    queryAddressFeeTotalsByDay(fromDay, toDay),
  ]);

  const denomSet = new Set<string>(Object.keys(transferVolumeByDenom));
  for (const [, byDenom] of volumeByAddressDenom) {
    for (const d of byDenom.keys()) denomSet.add(d);
  }
  for (const [, byDenom] of feeByAddressDenom) {
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
  const feeTotals = addressTotalsUsd(
    feeByAddressDenom,
    display,
    usdByCoinId,
    denomToCoinId
  );

  const summary = buildConcentrationSummary(volTotals, feeTotals, TOP_N);

  const concentrationOverTime = buildConcentrationOverTime(
    fromDay,
    toDay,
    addressTotalsUsdByDay(volumeByDayAddressDenom, display, usdByCoinId, denomToCoinId),
    addressTotalsUsdByDay(feeByDayAddressDenom, display, usdByCoinId, denomToCoinId),
    TOP_N
  );

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
      top10AddressShareGrossUsd: summary.topNShareGrossUsd === null ? null : formatSharePct(summary.topNShareGrossUsd),
      top10AddressShareFeesUsd: summary.topNShareFeesUsd === null ? null : formatSharePct(summary.topNShareFeesUsd),
      grossUsdHhi: summary.grossUsdHhi === null ? null : formatHhi(summary.grossUsdHhi),
      feesUsdHhi: summary.feesUsdHhi === null ? null : formatHhi(summary.feesUsdHhi),
    },
    distinctSendersByDenom: distinctSendersByDenom(volumeByAddressDenom),
    concentrationOverTime,
  };
}
