/**
 * Q4 support — retention shares from `queryRetentionCounts` results. Pure: the SQL supplies the three
 * distinct-address counts; this turns them into percentages and pairs the current window with the
 * prior one so the figure follows the same prior-window rule as every other delta.
 */
import type { RetentionCounts } from "@/lib/participationQueries";

export interface RetentionWindow extends RetentionCounts {
  /** retained ÷ active, %; null when nothing was active. */
  retainedSharePct: number | null;
  /** newAddresses ÷ active, %; null when nothing was active. */
  newSharePct: number | null;
}

export interface Retention {
  current: RetentionWindow;
  previous: RetentionWindow;
  /** Percentage-point change in retained share vs the prior window. */
  retainedShareDeltaPts: number | null;
}

export function retentionShares(c: RetentionCounts): RetentionWindow {
  const pct = (n: number) => (c.active > 0 ? (n / c.active) * 100 : null);
  return { ...c, retainedSharePct: pct(c.retained), newSharePct: pct(c.newAddresses) };
}

export function buildRetention(current: RetentionCounts, previous: RetentionCounts): Retention {
  const cur = retentionShares(current);
  const prev = retentionShares(previous);
  return {
    current: cur,
    previous: prev,
    retainedShareDeltaPts:
      cur.retainedSharePct !== null && prev.retainedSharePct !== null ? cur.retainedSharePct - prev.retainedSharePct : null,
  };
}
