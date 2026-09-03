/**
 * Trailing-window z-scores for a day-grain series: each day is compared with the mean and standard
 * deviation of the preceding `windowDays` points (the day itself excluded). |z| ≥ `threshold` marks
 * the day as unusual. This is deliberately simple — it tells a reader where to look, not why.
 *
 * Nulls are "no observation" (e.g. an unpriced day) and are skipped both as targets and as window
 * members; a window with fewer than `minPoints` observations yields no score. A window whose
 * standard deviation is ~0 also yields no score: a step off a flat line is real, but a z-score cannot
 * size it, so it is left to the raw series rather than reported as infinite.
 */

export interface DayValue {
  day: string;
  value: number | null;
}

export interface ScoredDay extends DayValue {
  /** Trailing z-score, or null when it could not be computed. */
  z: number | null;
}

export interface AnomalyPoint {
  day: string;
  value: number;
  z: number;
  direction: "high" | "low";
}

export interface AnomalyOptions {
  /** Trailing window length in points (default 30). */
  windowDays?: number;
  /** Minimum non-null points in the window to score (default 7). */
  minPoints?: number;
  /** |z| at or above which a day is flagged (default 2.5). */
  threshold?: number;
  /** Only days ≥ this are eligible to be flagged (the requested range start); earlier days are context. */
  flagFromDay?: string;
  /** Days ≥ this are never flagged — the current UTC day is incomplete and would always read "low". */
  flagBeforeDay?: string;
}

export const DEFAULT_ANOMALY_OPTIONS = { windowDays: 30, minPoints: 7, threshold: 2.5 } as const;

export function trailingZScores(
  points: readonly DayValue[],
  opts: AnomalyOptions = {}
): { scored: ScoredDay[]; flagged: AnomalyPoint[] } {
  const windowDays = opts.windowDays ?? DEFAULT_ANOMALY_OPTIONS.windowDays;
  const minPoints = opts.minPoints ?? DEFAULT_ANOMALY_OPTIONS.minPoints;
  const threshold = opts.threshold ?? DEFAULT_ANOMALY_OPTIONS.threshold;
  const sorted = [...points].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  const scored: ScoredDay[] = [];
  const flagged: AnomalyPoint[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i]!;
    let z: number | null = null;
    if (p.value !== null && Number.isFinite(p.value)) {
      const win: number[] = [];
      for (let j = Math.max(0, i - windowDays); j < i; j++) {
        const v = sorted[j]!.value;
        if (v !== null && Number.isFinite(v)) win.push(v);
      }
      if (win.length >= minPoints) {
        const mean = win.reduce((a, b) => a + b, 0) / win.length;
        const variance = win.reduce((a, b) => a + (b - mean) * (b - mean), 0) / win.length;
        const sd = Math.sqrt(variance);
        if (sd > 1e-9) z = (p.value - mean) / sd;
      }
    }
    scored.push({ day: p.day, value: p.value, z });
    const eligible = (!opts.flagFromDay || p.day >= opts.flagFromDay) && (!opts.flagBeforeDay || p.day < opts.flagBeforeDay);
    if (z !== null && Math.abs(z) >= threshold && p.value !== null && eligible) {
      flagged.push({ day: p.day, value: p.value, z, direction: z > 0 ? "high" : "low" });
    }
  }
  flagged.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  return { scored, flagged };
}
