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
  return alignBucketSeries({ gasUsed, gasWanted, blockGasLimit }).map(({ bucket, values }) => {
    // Each ratio needs both of ITS operands covered. gas_used sits at the Cosmos-level floor while
    // gas_wanted and block_gas_limit only start with the base indexer, so early buckets have a real
    // numerator and no denominator — exactly the case that must read blank rather than 0%.
    const used = values.gasUsed;
    const wanted = values.gasWanted;
    const limit = values.blockGasLimit;
    return {
      bucket,
      gasEfficiencyPct: used !== null && wanted !== null ? gasEfficiencyPct(used, wanted) : null,
      blockGasUtilizationPct: used !== null && limit !== null ? blockGasUtilizationPct(used, limit) : null,
    };
  });
}
