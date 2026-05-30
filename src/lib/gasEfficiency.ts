/** Shared ratio→percentage; null when the denominator is non-positive. Not clamped (anomalies stay visible). */
function pctRatio(numerator: bigint, denominator: bigint): number | null {
  if (denominator <= BigInt(0)) return null;
  return (Number(numerator) / Number(denominator)) * 100;
}

/**
 * Gas efficiency = gas_used / gas_wanted, as a percentage in [0, 100+].
 *
 * gas_wanted is the gas a tx reserved; gas_used is what it actually consumed. The ratio measures how
 * tightly users estimate the gas they request — a price-independent demand/estimation signal. It is
 * distinct from block-space utilization (see {@link blockGasUtilizationPct}).
 *
 * Returns null when gas_wanted is zero. Values can exceed 100 only on anomalous data (used > wanted).
 */
export function gasEfficiencyPct(gasUsed: bigint, gasWanted: bigint): number | null {
  return pctRatio(gasUsed, gasWanted);
}

/**
 * Block-space utilization (gas) = gas_used / block_gas_limit, as a percentage in [0, 100].
 *
 * block_gas_limit is the sum of per-block consensus `max_gas` over the bucket (the actual capacity for
 * block space), so this is the fraction of available block gas that was consumed — the true demand /
 * contention signal for block space. Returns null when no positive gas limit was recorded.
 */
export function blockGasUtilizationPct(gasUsed: bigint, blockGasLimit: bigint): number | null {
  return pctRatio(gasUsed, blockGasLimit);
}
