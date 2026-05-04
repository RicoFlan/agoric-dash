/**
 * Client-side sort helpers for the gross in-tx movement table (`Dashboard.tsx`).
 * USD cells are formatted currency strings from `formatUsdEstimate`; missing pricing is `null` / "—".
 */

export type GrossMovementRow = {
  key: string;
  denom: string;
  ticker: string;
  grossDisplay: string;
  grossUnknown: boolean;
  usd: string | null;
};

/** Parse Intl currency / formatted USD for numeric sort; NaN = missing or unpriced. */
export function parseUsdEstimateSortKey(usd: string | null): number {
  if (usd === null || usd === "" || usd === "—") return NaN;
  const cleaned = usd.replace(/[^\d.-]/g, "");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

/** Default row order: unknown ticker last, then ticker A→Z, then denom. */
export function compareGrossRowsDefault(a: GrossMovementRow, b: GrossMovementRow): number {
  const unk = (t: string) => (t === "—" ? 1 : 0);
  if (unk(a.ticker) !== unk(b.ticker)) return unk(a.ticker) - unk(b.ticker);
  const c = a.ticker.localeCompare(b.ticker, undefined, { sensitivity: "base" });
  if (c !== 0) return c;
  return a.denom.localeCompare(b.denom);
}

/**
 * Sort by parsed USD estimate. Rows without a price sort after priced rows.
 * Equal USD ties break with `compareGrossRowsDefault`.
 */
export function compareGrossRowsByUsd(
  a: GrossMovementRow,
  b: GrossMovementRow,
  dir: "asc" | "desc"
): number {
  const na = parseUsdEstimateSortKey(a.usd);
  const nb = parseUsdEstimateSortKey(b.usd);
  const aMiss = !Number.isFinite(na);
  const bMiss = !Number.isFinite(nb);
  if (aMiss && bMiss) return compareGrossRowsDefault(a, b);
  if (aMiss) return 1;
  if (bMiss) return -1;
  const diff = na - nb;
  if (diff !== 0) return dir === "asc" ? diff : -diff;
  return compareGrossRowsDefault(a, b);
}

export function sortGrossMovementRows(
  rows: GrossMovementRow[],
  usdSort: "default" | "asc" | "desc"
): GrossMovementRow[] {
  if (usdSort === "default") {
    return [...rows].sort(compareGrossRowsDefault);
  }
  return [...rows].sort((a, b) => compareGrossRowsByUsd(a, b, usdSort));
}
