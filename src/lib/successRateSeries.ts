import { alignBucketSeries, type BucketPoint } from "@/lib/bucketSeriesAlign";
import { successRatePct } from "@/lib/txSuccessRate";

export type SuccessRateRow = {
  bucket: string;
  /** Null when the bucket is before this series' coverage floor — not indexed, not zero. */
  successful: number | null;
  failed: number | null;
  /** tx_success / (tx_success + tx_failed) * 100; null when no aligned txs, or when either side is uncovered. */
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
    const s = values.successful;
    const f = values.failed;
    // A rate needs both sides covered; deriving one from a half-covered bucket would invent a number.
    const covered = s !== null && f !== null;
    return {
      bucket,
      successful: s === null ? null : Number(s),
      failed: f === null ? null : Number(f),
      successRatePct: covered ? successRatePct(s, f) : null,
    };
  });
}
