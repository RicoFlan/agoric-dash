/**
 * Per-block gas limit (consensus `block.max_gas`) for block-space utilization.
 *
 * agoric-3 CometBFT echoes `consensus_param_updates` on every block_results response, so the indexer
 * reads the limit from data it already fetches — no extra RPC call. Summed per bucket as the
 * `block_gas_limit` series, it is the denominator for true block-space utilization (gas):
 *   utilization = Σ gas_used / Σ block_gas_limit.
 *
 * Returns null when the limit is absent or non-positive ("-1" = unlimited / "0"); such blocks are not
 * counted toward the utilization denominator.
 */
import type { RpcBlockResultsResponse } from "@/lib/rpc";

export function maxGasFromBlockResults(results: RpcBlockResultsResponse): bigint | null {
  const raw = results.consensus_param_updates?.block?.max_gas;
  if (typeof raw !== "string" || !/^-?\d+$/.test(raw)) return null;
  const v = BigInt(raw);
  return v > BigInt(0) ? v : null;
}
