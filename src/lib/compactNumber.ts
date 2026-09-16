/**
 * Compact headline figures ("1.2M") paired with the exact value for a tooltip.
 *
 * Headlines are read at a glance and compared across ranges, where nine digits of a transaction
 * count are noise. The exact string always travels with the compact one so nothing is lost: the
 * dashboard shortens what it shows, never what it knows.
 *
 * Compaction starts at 10,000. Below that the full number is already short enough to read, and
 * rounding it would hide differences that matter at small counts.
 */

/** Values at or above this are abbreviated; below it, the exact number is shown. */
export const COMPACT_THRESHOLD = 10_000;

export interface CompactValue {
  /** What to display. */
  text: string;
  /** The full-precision string for a tooltip, or null when `text` is already exact. */
  exact: string | null;
}

function exactInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/**
 * Compact integer. Returns `exact: null` below the threshold so callers can skip the tooltip
 * rather than attach one that repeats the visible text.
 */
export function fmtCompactInt(n: number | null | undefined): CompactValue {
  if (n === null || n === undefined || !Number.isFinite(n)) return { text: "—", exact: null };
  const abs = Math.abs(n);
  if (abs < COMPACT_THRESHOLD) return { text: exactInt(n), exact: null };
  const text = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  return { text, exact: exactInt(n) };
}

/** Compact USD, using the same threshold and the same all-or-nothing tooltip rule. */
export function fmtCompactUsd(n: number | null | undefined, signed = false): CompactValue {
  if (n === null || n === undefined || !Number.isFinite(n)) return { text: "—", exact: null };
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : signed && n > 0 ? "+" : "";
  const exact = `${sign}${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(abs)}`;
  if (abs < COMPACT_THRESHOLD) return { text: exact, exact: null };
  const compact = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(abs);
  return { text: `${sign}${compact}`, exact };
}
