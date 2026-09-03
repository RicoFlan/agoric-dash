/**
 * Herfindahl–Hirschman-style concentration on share vectors (0–1 each, sum ≈ 1).
 * Used for denom / address USD share diagnostics (not antitrust HHI bands).
 */

/** H = sum(s_i^2). If totalWeight is 0, returns null. */
export function herfindahlFromWeights(weights: number[]): number | null {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(sum) || sum <= 0) return null;
  const shares = weights.map((w) => w / sum);
  return shares.reduce((h, s) => h + s * s, 0);
}

/**
 * Share of the top-`n` values in the same units as `values` (e.g. USD).
 * Returns null if total is 0.
 */
export function topNShare(valuesSortedDesc: number[], n: number): number | null {
  if (n < 1 || valuesSortedDesc.length === 0) return null;
  const total = valuesSortedDesc.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  let top = 0;
  for (let i = 0; i < Math.min(n, valuesSortedDesc.length); i++) {
    top += valuesSortedDesc[i]!;
  }
  return top / total;
}

/**
 * Effective number of equally-weighted participants implied by an HHI: 1 / H. An HHI of 0.071 reads
 * as "activity equivalent to ~14 equally-active addresses" — same information, human units.
 */
export function effectiveNumberFromHhi(hhi: number | null): number | null {
  if (hhi === null || !Number.isFinite(hhi) || hhi <= 0) return null;
  return 1 / hhi;
}
