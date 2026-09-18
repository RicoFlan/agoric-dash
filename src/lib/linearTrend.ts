/**
 * Ordinary least-squares line over indices 0..n-1 vs values[i]. Uses only finite values for fit, and
 * emits one ordinate per index so Recharts stays aligned with bucket rows.
 *
 * A **null** input is a bucket before that series' coverage floor — not indexed (coverageFloors.ts).
 * Nulls are excluded from the fit AND emitted as null, so the trend gaps with the series instead of
 * being drawn confidently across a period nobody looked at. NaN keeps its old meaning: excluded from
 * the fit, but still given an ordinate, since it is a missing value inside covered ground.
 */
export function linearTrendLine(values: readonly (number | null)[]): (number | null)[] {
  const n = values.length;
  if (n === 0) return [];

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  let count = 0;

  for (let i = 0; i < n; i++) {
    const y = values[i];
    if (y === null || !Number.isFinite(y)) continue;
    sumX += i;
    sumY += y;
    sumXY += i * y;
    sumX2 += i * i;
    count += 1;
  }

  const at = (i: number, v: number) => (values[i] === null ? null : v);
  if (count === 0) {
    return Array.from({ length: n }, (_, i) => at(i, 0));
  }
  if (count === 1) {
    const v = sumY;
    return Array.from({ length: n }, (_, i) => at(i, v));
  }

  const denom = count * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-12) {
    const mean = sumY / count;
    return Array.from({ length: n }, (_, i) => at(i, mean));
  }

  const slope = (count * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / count;

  return Array.from({ length: n }, (_, i) => at(i, slope * i + intercept));
}
