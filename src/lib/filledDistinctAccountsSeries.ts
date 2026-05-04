/**
 * Build a dense UTC calendar-day series for distinct-account charts:
 * one row per day from `fromDay` through `toDay` inclusive; missing sparse days → count 0.
 */
export function filledDistinctAccountsPerDay(
  fromDay: string,
  toDay: string,
  sparse: ReadonlyArray<{ day: string; count: string | number }>
): { bucket: string; distinctAccounts: number }[] {
  const m = new Map<string, number>();
  for (const r of sparse) {
    const k = r.day.slice(0, 10);
    const n = typeof r.count === "number" ? r.count : Number(r.count);
    m.set(k, Number.isFinite(n) ? n : 0);
  }

  const start = new Date(`${fromDay.slice(0, 10)}T00:00:00.000Z`);
  const end = new Date(`${toDay.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }

  const out: { bucket: string; distinctAccounts: number }[] = [];
  for (let d = new Date(start); d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    const bucket = d.toISOString().slice(0, 10);
    const c = m.get(bucket);
    out.push({
      bucket,
      distinctAccounts: c === undefined ? 0 : c,
    });
  }
  return out;
}
