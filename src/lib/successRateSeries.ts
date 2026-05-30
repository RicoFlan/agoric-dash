import { alignBucketSeries, type BucketPoint } from "@/lib/bucketSeriesAlign";
import { successRatePct } from "@/lib/txSuccessRate";

export type SuccessRateRow = {
  bucket: string;
  successful: number;
  failed: number;
  /** tx_success / (tx_success + tx_failed) * 100, or null when no aligned txs in the bucket. */
  successRatePct: number | null;
};

/**
 * Per-bucket transaction success-rate rows from the raw success / failed count series. Reuses
 * {@link successRatePct} so the trend line matches the headline KPI's basis exactly.
 */
export function buildSuccessRateRows(
  successful: readonly BucketPoint[],
  failed: readonly BucketPoint[]
): SuccessRateRow[] {
  return alignBucketSeries({ successful, failed }).map(({ bucket, values }) => {
    const s = values.successful!;
    const f = values.failed!;
    return {
      bucket,
      successful: Number(s),
      failed: Number(f),
      successRatePct: successRatePct(s, f),
    };
  });
}
