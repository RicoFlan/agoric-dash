/**
 * Per-day concentration trend (HHI + top-N share) for gross-movement USD and paid-fee USD.
 *
 * Daily-grain by construction: the address_volume_day / address_fee_day tables are keyed by UTC day,
 * so concentration is computed one point per calendar day regardless of the dashboard granularity.
 * Pure: callers pass already-priced per-address USD totals per day so this stays DB/network free.
 */
import { buildConcentrationSummary } from "@/lib/concentrationSummary";

export type ConcentrationTimePoint = {
  day: string;
  /** HHI (0–1) of gross-movement USD across addresses that day, or null when unpriced/empty. */
  grossUsdHhi: number | null;
  /** HHI (0–1) of paid-fee USD across fee payers that day, or null when unpriced/empty. */
  feesUsdHhi: number | null;
  /** Top-N gross-movement USD share that day as a percentage (0–100), or null. */
  top10ShareGrossUsdPct: number | null;
  /** Top-N paid-fee USD share that day as a percentage (0–100), or null. */
  top10ShareFeesUsdPct: number | null;
};

function eachUtcDay(fromDay: string, toDay: string): string[] {
  const start = new Date(`${fromDay.slice(0, 10)}T00:00:00.000Z`);
  const end = new Date(`${toDay.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
  const out: string[] = [];
  for (let d = new Date(start); d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function pct(share: number | null): number | null {
  return share === null || !Number.isFinite(share) ? null : share * 100;
}

/**
 * Build a dense per-day concentration series across [fromDay, toDay]. Days with no priced addresses
 * yield null metrics (chart gaps), so the line reflects actual activity rather than implying zeros.
 *
 * @param grossTotalsByDay day → per-address gross-movement USD totals
 * @param feeTotalsByDay day → per-fee-payer paid-fee USD totals
 * @param topN leading addresses for the top-N share (e.g. 10)
 */
export function buildConcentrationOverTime(
  fromDay: string,
  toDay: string,
  grossTotalsByDay: ReadonlyMap<string, number[]>,
  feeTotalsByDay: ReadonlyMap<string, number[]>,
  topN: number
): ConcentrationTimePoint[] {
  return eachUtcDay(fromDay, toDay).map((day) => {
    const gross = grossTotalsByDay.get(day) ?? [];
    const fees = feeTotalsByDay.get(day) ?? [];
    const summary = buildConcentrationSummary(gross, fees, topN);
    return {
      day,
      grossUsdHhi: summary.grossUsdHhi,
      feesUsdHhi: summary.feesUsdHhi,
      top10ShareGrossUsdPct: pct(summary.topNShareGrossUsd),
      top10ShareFeesUsdPct: pct(summary.topNShareFeesUsd),
    };
  });
}
