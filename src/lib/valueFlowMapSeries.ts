import { valueToChartNumber } from "@/lib/displayFormat";
import type { EnrichedDisplay } from "@/lib/metricsDisplayTypes";

type BucketPoint = { bucket: string; value: string };

export type ValueFlowMiniRow = {
  bucket: string;
  gross: number;
  transferLike: number;
  ibcIn: number;
  credits: number;
  ibcOut: number;
};

function finiteN(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

function collectBuckets(...series: (BucketPoint[] | undefined)[]): string[] {
  const set = new Set<string>();
  for (const pts of series) {
    for (const p of pts ?? []) set.add(p.bucket);
  }
  return [...set].sort();
}

function pointValue(pts: BucketPoint[] | undefined, bucket: string): string {
  return pts?.find((p) => p.bucket === bucket)?.value ?? "0";
}

/** Per-bucket human amounts for the selected denom (mini charts in Value Flow Map). */
export function buildValueFlowMiniRows(
  denom: string,
  gross: BucketPoint[] | undefined,
  credits: BucketPoint[] | undefined,
  ibcIn: BucketPoint[] | undefined,
  ibcOut: BucketPoint[] | undefined,
  display?: EnrichedDisplay
): ValueFlowMiniRow[] {
  const toN = (atomic: string) => finiteN(valueToChartNumber(atomic, denom, display));
  return collectBuckets(gross, credits, ibcIn, ibcOut).map((bucket) => {
    const g = toN(pointValue(gross, bucket));
    const iIn = toN(pointValue(ibcIn, bucket));
    return {
      bucket,
      gross: g,
      transferLike: finiteN(Math.max(0, g - iIn)),
      ibcIn: iIn,
      credits: toN(pointValue(credits, bucket)),
      ibcOut: toN(pointValue(ibcOut, bucket)),
    };
  });
}
