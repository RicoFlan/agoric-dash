import {
  buildConcentrationSummary,
  formatHhi,
  formatSharePct,
} from "@/lib/concentrationSummary";
import {
  buildConcentrationOverTime,
  type ConcentrationTimePoint,
} from "@/lib/concentrationTimeseries";
import { type DailyPriceTable, denomToCoinIdMap, usdForLeg, type UsdPricer, type UsdPricingMeta } from "@/lib/denomPrices";
import { distinctSendersByDenom } from "@/lib/distinctSenders";
import type { EnrichedDisplay } from "@/lib/metricsDisplayTypes";
import {
  queryAddressFeeTotalsByDay,
  queryAddressVolumeTotalsByDay,
  queryParticipationRange,
} from "@/lib/participationQueries";

const TOP_N = 10;

type ByDayAddrDenom = Map<string, Map<string, Map<string, bigint>>>;

function denomsIn(byDay: ByDayAddrDenom): Set<string> {
  const s = new Set<string>();
  for (const byAddr of byDay.values()) for (const byDenom of byAddr.values()) for (const d of byDenom.keys()) s.add(d);
  return s;
}

/** Collapse day → address → denom into address → denom (range totals) for distinct-sender counts. */
function collapseDays(byDay: ByDayAddrDenom): Map<string, Map<string, bigint>> {
  const out = new Map<string, Map<string, bigint>>();
  for (const byAddr of byDay.values()) {
    for (const [addr, byDenom] of byAddr) {
      let acc = out.get(addr);
      if (!acc) {
        acc = new Map();
        out.set(addr, acc);
      }
      for (const [d, v] of byDenom) acc.set(d, (acc.get(d) ?? BigInt(0)) + v);
    }
  }
  return out;
}

/**
 * Per-address USD totals over the range, each (address, denom, day) leg priced at that day's row.
 * Returns the sorted positive totals (what the concentration math consumes) and the per-day
 * equivalent for the trend, from one pass over the same rows.
 */
function addressUsdTotals(
  byDay: ByDayAddrDenom,
  display: EnrichedDisplay,
  denomToCoinId: Map<string, string>,
  pricer: UsdPricer
): { range: number[]; byDay: Map<string, number[]> } {
  const rangeByAddr = new Map<string, number>();
  const out = new Map<string, number[]>();
  for (const [day, byAddr] of byDay) {
    const dayTotals: number[] = [];
    for (const [addr, byDenom] of byAddr) {
      let u = 0;
      for (const [d, atomic] of byDenom) u += usdForLeg(d, day, atomic, display, denomToCoinId, pricer) ?? 0;
      if (u > 0) {
        dayTotals.push(u);
        rangeByAddr.set(addr, (rangeByAddr.get(addr) ?? 0) + u);
      }
    }
    out.set(day, dayTotals.sort((a, b) => b - a));
  }
  return { range: [...rangeByAddr.values()].sort((a, b) => b - a), byDay: out };
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
    /** Share of gross-movement USD from top 10 addresses (sender-side indexed legs, day-priced). */
    top10AddressShareGrossUsd: string | null;
    /** Share of paid-fee USD from the top 10 fee payers (day-priced). */
    top10AddressShareFeesUsd: string | null;
    /** Herfindahl–Hirschman index (0–1) of gross-movement USD across addresses. */
    grossUsdHhi: string | null;
    /** Herfindahl–Hirschman index (0–1) of paid-fee USD across fee payers. */
    feesUsdHhi: string | null;
    /** Basis of the USD figures above (day rows vs spot fallback). */
    usdPricingMeta: UsdPricingMeta;
  };
  /** Unformatted concentration numbers (0–1 shares / HHI) for downstream derivations such as effective-N. */
  concentrationRaw: {
    topNShareGrossUsd: number | null;
    topNShareFeesUsd: number | null;
    grossUsdHhi: number | null;
    feesUsdHhi: number | null;
  };
  /** Distinct sending addresses per denom (range) — wash/overcounting guardrail for gross volume. */
  distinctSendersByDenom: Record<string, number>;
  /** Daily concentration trend (HHI + top-10 share) for gross-movement USD and paid-fee USD. */
  concentrationOverTime: ConcentrationTimePoint[];
};

/** Keep only the days in [fromDay, toDay] of a wider day-keyed map. */
function sliceDays<T>(m: Map<string, T>, fromDay: string, toDay: string): Map<string, T> {
  const out = new Map<string, T>();
  for (const [day, v] of m) if (day >= fromDay && day <= toDay) out.set(day, v);
  return out;
}

export async function enrichParticipationAndConcentration(
  fromDay: string,
  toDay: string,
  display: EnrichedDisplay,
  table: DailyPriceTable,
  /** Fee map already fetched for a wider window (the questions context) — sliced here instead of re-queried. */
  prefetched?: { feeByDay: ByDayAddrDenom }
): Promise<ParticipationConcentrationPackage> {
  const [participation, volumeByDay, feeByDay] = await Promise.all([
    queryParticipationRange(fromDay, toDay),
    queryAddressVolumeTotalsByDay(fromDay, toDay),
    prefetched ? Promise.resolve(sliceDays(prefetched.feeByDay, fromDay, toDay)) : queryAddressFeeTotalsByDay(fromDay, toDay),
  ]);

  const denomToCoinId = denomToCoinIdMap(new Set([...denomsIn(volumeByDay), ...denomsIn(feeByDay)]));
  await table.ensureSpot(denomToCoinId.values());
  const pricer = table.pricer();

  const vol = addressUsdTotals(volumeByDay, display, denomToCoinId, pricer);
  const fee = addressUsdTotals(feeByDay, display, denomToCoinId, pricer);

  const summary = buildConcentrationSummary(vol.range, fee.range, TOP_N);
  const concentrationOverTime = buildConcentrationOverTime(fromDay, toDay, vol.byDay, fee.byDay, TOP_N);

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
      usdPricingMeta: pricer.meta(),
    },
    concentrationRaw: {
      topNShareGrossUsd: summary.topNShareGrossUsd,
      topNShareFeesUsd: summary.topNShareFeesUsd,
      grossUsdHhi: summary.grossUsdHhi,
      feesUsdHhi: summary.feesUsdHhi,
    },
    distinctSendersByDenom: distinctSendersByDenom(collapseDays(volumeByDay)),
    concentrationOverTime,
  };
}
