/**
 * Pairing policy when CometBFT `block.data.txs` and `block_results.txs_results` differ in length.
 * Rollups index only aligned pairs by position i ∈ [0, min(blockTxCount, txResultsCount)).
 */

export const BLOCK_TX_RESULTS_PAIRING_POLICY =
  "Align block transactions with txs_results by index; process min(block_tx_count, txs_results_count) pairs; ignore trailing entries on the longer side." as const;

/** Number of tx × result pairs processed (Cosmos-aligned bounded pairing). */
export function pairedTxCount(blockTxCount: number, txsResultsCount: number): number {
  return Math.min(Math.max(0, blockTxCount), Math.max(0, txsResultsCount));
}

/**
 * When lengths differ, returns a one-line detail for logs (which side has excess rows).
 */
export function describeTxResultsLengthMismatch(
  blockTxCount: number,
  txsResultsCount: number
): string | null {
  if (blockTxCount === txsResultsCount) return null;
  const parts: string[] = [
    `block txs=${blockTxCount} vs txs_results=${txsResultsCount}`,
    `pairing ${pairedTxCount(blockTxCount, txsResultsCount)} tx(es)`,
  ];
  if (blockTxCount > txsResultsCount) {
    parts.push(`${blockTxCount - txsResultsCount} block tx(s) have no paired result row`);
  }
  if (txsResultsCount > blockTxCount) {
    parts.push(`${txsResultsCount - blockTxCount} txs_results row(s) have no paired block tx`);
  }
  return parts.join("; ");
}
