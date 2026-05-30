/** A single point in a per-bucket metric series (bucket label + numeric value as string). */
export type BucketPoint = { bucket: string; value: string };

function toBigint(v: string | undefined): bigint {
  if (v === undefined) return BigInt(0);
  try {
    return BigInt(v);
  } catch {
    return BigInt(0);
  }
}

/**
 * Align several named per-bucket series onto the sorted union of their buckets. Missing values for a
 * bucket become 0. Used to join raw rollup series (success/failed, gas, staking/gov counts) into rows
 * ready for derived-rate computation or multi-line charts.
 */
export function alignBucketSeries(
  named: Record<string, readonly BucketPoint[]>
): Array<{ bucket: string; values: Record<string, bigint> }> {
  const names = Object.keys(named);
  const buckets = new Set<string>();
  const byName: Record<string, Map<string, string>> = {};
  for (const name of names) {
    const m = new Map<string, string>();
    for (const p of named[name] ?? []) {
      m.set(p.bucket, p.value);
      buckets.add(p.bucket);
    }
    byName[name] = m;
  }
  const sorted = [...buckets].sort();
  return sorted.map((bucket) => {
    const values: Record<string, bigint> = {};
    for (const name of names) {
      values[name] = toBigint(byName[name]!.get(bucket));
    }
    return { bucket, values };
  });
}
