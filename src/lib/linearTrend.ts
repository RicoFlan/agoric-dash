/**
 * Ordinary least-squares line over indices 0..n-1 vs values[i]. Uses only finite values for fit;
 * still emits one trend ordinate per index so Recharts stays aligned with bucket rows.
 */
export function linearTrendLine(values: readonly number[]): number[] {
  const n = values.length;
  if (n === 0) return [];

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  let count = 0;

  for (let i = 0; i < n; i++) {
    const y = values[i];
    if (!Number.isFinite(y)) continue;
    sumX += i;
    sumY += y;
    sumXY += i * y;
    sumX2 += i * i;
    count += 1;
  }

  if (count === 0) {
    return Array.from({ length: n }, () => 0);
  }
  if (count === 1) {
    const v = sumY;
    return Array.from({ length: n }, () => v);
  }

  const denom = count * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-12) {
    const mean = sumY / count;
    return Array.from({ length: n }, () => mean);
  }

  const slope = (count * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / count;

  return Array.from({ length: n }, (_, i) => slope * i + intercept);
}
