/**
 * A single point in a per-bucket metric series (bucket label + numeric value as string).
 *
 * `value` is null when the bucket lies before that series' coverage floor — not indexed, as opposed
 * to indexed and zero (see coverageFloors.ts). The two must not be collapsed: doing so is what let
 * the dashboard report zero governance activity for months it never looked at.
 */
export type BucketPoint = { bucket: string; value: string | null };

function toBigint(v: string | null | undefined): bigint | null {
  // A bucket absent from one series but present in another is a genuine zero for that series: the
  // series was being written, the bucket simply held nothing. An explicit null is NOT that.
  if (v === undefined) return BigInt(0);
  if (v === null) return null;
  try {
    return BigInt(v);
  } catch {
    return BigInt(0);
  }
}

/**
 * Align several named per-bucket series onto the sorted union of their buckets. A value missing from
 * the input becomes 0; an explicit null stays null and propagates into anything derived from it.
 * Used to join raw rollup series (success/failed, gas, staking/gov counts) into rows ready for
 * derived-rate computation or multi-line charts.
 */
export function alignBucketSeries(
  named: Record<string, readonly BucketPoint[]>
): Array<{ bucket: string; values: Record<string, bigint | null> }> {
  const names = Object.keys(named);
  const buckets = new Set<string>();
  const byName: Record<string, Map<string, string | null>> = {};
  for (const name of names) {
    const m = new Map<string, string | null>();
    for (const p of named[name] ?? []) {
      m.set(p.bucket, p.value);
      buckets.add(p.bucket);
    }
    byName[name] = m;
  }
  const sorted = [...buckets].sort();
  return sorted.map((bucket) => {
    const values: Record<string, bigint | null> = {};
    for (const name of names) {
      values[name] = toBigint(byName[name]!.get(bucket));
    }
    return { bucket, values };
  });
}
