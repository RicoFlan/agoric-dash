/**
 * Builds the concentration figures surfaced in Economic participation & concentration from
 * per-address USD totals. Two dimensions:
 *  - gross-movement USD (sender-side indexed transfer legs)
 *  - paid-fee USD (resolved fee payer)
 *
 * Fees are the costliest on-chain signal, so fee concentration is the most wash/Sybil-resistant
 * view (faking fee breadth costs real money). For each dimension we report the top-N address share
 * and a Herfindahl–Hirschman index (HHI = Σ shareᵢ²) over the per-address USD weights.
 *
 * Pure: callers pass already-priced per-address USD totals so this stays DB/network free and testable.
 */
import { herfindahlFromWeights, topNShare } from "@/lib/concentrationMath";

export type ConcentrationSummary = {
  /** Share (0–1) of gross-movement USD held by the top-N addresses, or null when unpriced/empty. */
  topNShareGrossUsd: number | null;
  /** Share (0–1) of paid-fee USD from the top-N fee payers, or null when unpriced/empty. */
  topNShareFeesUsd: number | null;
  /** HHI (0–1) of gross-movement USD across addresses, or null when unpriced/empty. */
  grossUsdHhi: number | null;
  /** HHI (0–1) of paid-fee USD across fee payers, or null when unpriced/empty. */
  feesUsdHhi: number | null;
};

/**
 * @param grossUsdTotals per-address gross-movement USD totals (any order; non-negative)
 * @param feesUsdTotals per-fee-payer paid-fee USD totals (any order; non-negative)
 * @param topN number of leading addresses for the top-N share (e.g. 10)
 */
export function buildConcentrationSummary(
  grossUsdTotals: number[],
  feesUsdTotals: number[],
  topN: number
): ConcentrationSummary {
  const grossDesc = [...grossUsdTotals].sort((a, b) => b - a);
  const feesDesc = [...feesUsdTotals].sort((a, b) => b - a);
  return {
    topNShareGrossUsd: topNShare(grossDesc, topN),
    topNShareFeesUsd: topNShare(feesDesc, topN),
    grossUsdHhi: herfindahlFromWeights(grossUsdTotals),
    feesUsdHhi: herfindahlFromWeights(feesUsdTotals),
  };
}

/** Format a 0–1 share as a percentage string (1 dp), or "—" when null. */
export function formatSharePct(share: number | null): string {
  if (share === null || !Number.isFinite(share)) return "—";
  return `${(share * 100).toFixed(1)}%`;
}

/** Format a 0–1 HHI index (3 dp), or "—" when null. */
export function formatHhi(hhi: number | null): string {
  if (hhi === null || !Number.isFinite(hhi)) return "—";
  return hhi.toFixed(3);
}
