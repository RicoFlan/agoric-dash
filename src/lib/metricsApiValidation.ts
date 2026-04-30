import type { Granularity } from "@/lib/metricsQuery";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Hard cap on requested calendar span (day/week); aligns with sensible dashboard use and DB load. */
export const MAX_RANGE_DAYS_DAY_OR_WEEK = 366;

/** Hour buckets scale with span; keep DB reads bounded. */
export const MAX_RANGE_DAYS_HOUR = 62;

export function validateMetricsQuery(
  from: string,
  to: string,
  granularity: Granularity
): string | null {
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to)) {
    return "`from` and `to` must be dates in YYYY-MM-DD form.";
  }
  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const toMs = Date.parse(`${to}T23:59:59.000Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return "Invalid `from` or `to` date.";
  }
  if (fromMs > toMs) {
    return "`from` must be on or before `to`.";
  }
  const windowDays = Math.round((toMs - fromMs) / 86_400_000) + 1;
  if (granularity === "hour") {
    if (windowDays > MAX_RANGE_DAYS_HOUR) {
      return `For hour granularity, the range must be at most ${MAX_RANGE_DAYS_HOUR} days.`;
    }
  } else if (windowDays > MAX_RANGE_DAYS_DAY_OR_WEEK) {
    return `The date range must be at most ${MAX_RANGE_DAYS_DAY_OR_WEEK} days.`;
  }
  return null;
}
