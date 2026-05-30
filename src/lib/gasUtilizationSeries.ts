import { alignBucketSeries, type BucketPoint } from "@/lib/bucketSeriesAlign";
import { blockGasUtilizationPct, gasEfficiencyPct } from "@/lib/gasEfficiency";

export type GasUtilizationRow = {
  bucket: string;
  /** gas_used / gas_wanted * 100 (how much reserved gas was actually consumed), null when none requested. */
  gasEfficiencyPct: number | null;
  /** gas_used / block_gas_limit * 100 (true block-space demand), null when no limit recorded. */
  blockGasUtilizationPct: number | null;
};

/**
 * Per-bucket gas efficiency and block-space utilization rows from the raw gas series. Reuses the
 * same {@link gasEfficiencyPct} / {@link blockGasUtilizationPct} helpers as the headline KPIs.
 */
export function buildGasUtilizationRows(
  gasUsed: readonly BucketPoint[],
  gasWanted: readonly BucketPoint[],
  blockGasLimit: readonly BucketPoint[]
): GasUtilizationRow[] {
  return alignBucketSeries({ gasUsed, gasWanted, blockGasLimit }).map(({ bucket, values }) => ({
    bucket,
    gasEfficiencyPct: gasEfficiencyPct(values.gasUsed!, values.gasWanted!),
    blockGasUtilizationPct: blockGasUtilizationPct(values.gasUsed!, values.blockGasLimit!),
  }));
}
