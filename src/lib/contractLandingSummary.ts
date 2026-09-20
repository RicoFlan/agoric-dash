/**
 * Pure shaping of contract-landing rows into the figures Q4 shows.
 *
 * **Read the counts for what they are.** 30 installs over nine months is not a trend series; it is
 * a short list of events. The brief asks for this as a signal that the base is "broadening in
 * deployed contracts and not only in addresses", and at this volume a month-on-month percentage
 * would be noise dressed as a measurement — two installs against one is not a 100% increase in
 * anything. So the summary reports counts, the distinct parties behind them, and the fee flow;
 * it deliberately computes no growth rate.
 *
 * The storage fee is the part that carries weight. It is large relative to the gas on the same
 * transactions — about 61× per install — and it is missing from `fee_paid` entirely, so a range's
 * true BLD fee total is the recorded one PLUS this.
 */
import type { ContractLandingDay } from "@/lib/contractLandingQuery";

export interface ContractLandingSummary {
  readonly installs: number;
  readonly distinctInstallers: number;
  /** Storage fee for the range, ubld. */
  readonly storageFeeUbld: string;
  /** Gas fee on the same txs, ubld — a subset of `fee_paid`, not an addition to it. */
  readonly gasFeeUbld: string;
  /** Days in the range on which at least one contract landed. */
  readonly daysWithLandings: number;
  /**
   * Installs whose storage fee is not in the total, because the tx carried other messages and the
   * charge cannot be separated from what they spent. Zero so far; non-zero means the fee figures
   * describe fewer installs than the count does.
   */
  readonly ambiguousInstalls: number;
  /** Storage fee as a share of total BLD fees once it is included. Null when there are no fees. */
  readonly shareOfTotalBldFeesPct: number | null;
}

export function summarizeContractLandings(
  daily: readonly ContractLandingDay[],
  opts: { distinctInstallers: number; recordedFeePaidUbld?: string | null }
): ContractLandingSummary {
  const storage = daily.reduce((n, d) => n + BigInt(d.storageFeeUbld), BigInt(0));
  const gas = daily.reduce((n, d) => n + BigInt(d.gasFeeUbld), BigInt(0));
  const recorded = opts.recordedFeePaidUbld != null ? BigInt(opts.recordedFeePaidUbld) : null;

  // `fee_paid` excludes the storage fee, so the true total is recorded + storage and the share is
  // taken against that. Dividing by the recorded figure alone would overstate it.
  let share: number | null = null;
  if (recorded !== null) {
    const total = recorded + storage;
    share = total > BigInt(0) ? (Number(storage) / Number(total)) * 100 : null;
  }

  return {
    installs: daily.reduce((n, d) => n + d.installs, 0),
    distinctInstallers: opts.distinctInstallers,
    storageFeeUbld: storage.toString(),
    gasFeeUbld: gas.toString(),
    daysWithLandings: daily.filter((d) => d.installs > 0).length,
    ambiguousInstalls: daily.reduce((n, d) => n + (d.ambiguousInstalls ?? 0), 0),
    shareOfTotalBldFeesPct: share,
  };
}
