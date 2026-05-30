/**
 * Tx success-rate helpers. Success rate = tx_success / (tx_success + tx_failed).
 *
 * Failed inclusions still consume gas (see TX_RESULT_ROLLUP_POLICY), so the rate is a
 * spam / health signal that contextualizes the raw successful-tx count. Returns `null`
 * when there are no aligned txs in the window (no rate is defined).
 */

/** Percentage in [0, 100], or null when total is zero. */
export function successRatePct(success: bigint, failed: bigint): number | null {
  const total = success + failed;
  if (total <= BigInt(0)) return null;
  // Tx counts are well within Number's safe-integer range; ratio avoids bigint truncation.
  return (Number(success) / Number(total)) * 100;
}

/** Display string for a rate value from {@link successRatePct} (2 dp), or "—" when null. */
export function formatRatePct(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return "—";
  return `${rate.toFixed(2)}%`;
}
