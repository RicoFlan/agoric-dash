/**
 * Reconcile `hourly_metrics` sums to `daily_metrics` per UTC calendar day.
 * Used by tests and `scripts/verifyRollupParity.ts` to catch drift, partial writes, or double-counts.
 */

export type DailyMetricRow = {
  readonly day: string;
  readonly series: string;
  readonly dimension: string;
  readonly value: string;
};

export type HourlyMetricRow = {
  readonly hour: Date;
  readonly series: string;
  readonly dimension: string;
  readonly value: string;
};

/** Inclusive start, exclusive end in milliseconds for UTC calendar day `YYYY-MM-DD`. */
export function utcDayMillisBounds(dayUtc: string): { startMs: number; endMs: number } {
  const m = dayUtc.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`dayUtc must be YYYY-MM-DD, got ${dayUtc}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const startMs = Date.UTC(y, mo - 1, d, 0, 0, 0, 0);
  const endMs = Date.UTC(y, mo - 1, d + 1, 0, 0, 0, 0);
  return { startMs, endMs };
}

function rollupKey(series: string, dimension: string): string {
  return `${series}\0${dimension}`;
}

export type HourlyDailyMismatch = {
  readonly series: string;
  readonly dimension: string;
  readonly dailyValue: string;
  readonly hourlySum: string;
};

/**
 * Compare every (series, dimension) present in either daily rows for `dayUtc` or hourly rows whose
 * timestamp falls in that UTC day.
 */
export function compareHourlyDailyParity(
  dailyRows: readonly DailyMetricRow[],
  hourlyRows: readonly HourlyMetricRow[],
  dayUtc: string
): { readonly ok: boolean; readonly mismatches: HourlyDailyMismatch[] } {
  const { startMs, endMs } = utcDayMillisBounds(dayUtc);
  const dailyMap = new Map<string, bigint>();
  for (const r of dailyRows) {
    if (r.day.slice(0, 10) !== dayUtc) continue;
    const k = rollupKey(r.series, r.dimension);
    dailyMap.set(k, (dailyMap.get(k) ?? BigInt(0)) + BigInt(r.value || "0"));
  }

  const hourlyMap = new Map<string, bigint>();
  for (const r of hourlyRows) {
    const t = r.hour.getTime();
    if (t < startMs || t >= endMs) continue;
    const k = rollupKey(r.series, r.dimension);
    hourlyMap.set(k, (hourlyMap.get(k) ?? BigInt(0)) + BigInt(r.value || "0"));
  }

  const keys = new Set<string>([...dailyMap.keys(), ...hourlyMap.keys()]);
  const mismatches: HourlyDailyMismatch[] = [];
  for (const k of keys) {
    const d = dailyMap.get(k) ?? BigInt(0);
    const h = hourlyMap.get(k) ?? BigInt(0);
    if (d !== h) {
      const [series, ...dimParts] = k.split("\0");
      mismatches.push({
        series,
        dimension: dimParts.join("\0"),
        dailyValue: d.toString(),
        hourlySum: h.toString(),
      });
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}
