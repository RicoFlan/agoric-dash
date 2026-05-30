/**
 * Normalized (denominator-aware) ratios. Raw totals are Sybil/spam-sensitive; dividing by an
 * appropriate denominator gives more defensible, comparable activity signals:
 *  - gas per included tx (success + failed) — gas_used spans every inclusion
 *  - paid fees (BLD) per successful tx — fees only accrue on ABCI code 0
 *  - successful txs per active address — counters "one bot, many txs" inflation
 *  - gross USD moved per active address — counters Sybil interpretation of raw volume
 *
 * "Active address" = distinct signer addresses in the range (the broad participation set).
 *
 * Pure + numeric in/out so it is unit-testable without DB or network; the API route extracts the
 * raw inputs (kpis, participation counts, parsed USD total) and formats the result.
 */
import { formatUsdEstimate } from "@/lib/transferVolumeUsdEstimates";

export type NormalizedRatioValues = {
  /** ABCI gas units per included tx (success + failed), or null when no txs. */
  gasPerTx: number | null;
  /** Paid fees in BLD per successful tx, or null when no successful txs. */
  feeBldPerSuccessfulTx: number | null;
  /** Successful txs per active (signer) address, or null when no active addresses. */
  successfulTxsPerActiveAddress: number | null;
  /** Gross-movement USD per active address, or null when unpriced / no active addresses. */
  grossUsdPerActiveAddress: number | null;
};

export type NormalizedRatioStrings = {
  gasPerTx: string;
  feeBldPerSuccessfulTx: string;
  successfulTxsPerActiveAddress: string;
  grossUsdPerActiveAddress: string;
};

export type NormalizedRatioInput = {
  gasUsed: bigint;
  successfulTxs: bigint;
  failedTxs: bigint;
  feeUbld: bigint;
  /** Decimals for the fee denom (ubld → BLD = 6). */
  feeDenomDecimals: number;
  /** Distinct signer addresses in range (active-address denominator). */
  activeAddresses: number;
  /** Parsed gross-movement USD total for the range, or null when unpriced. */
  grossUsdTotal: number | null;
};

function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

export function computeNormalizedRatios(input: NormalizedRatioInput): NormalizedRatioValues {
  const totalTxs = input.successfulTxs + input.failedTxs;
  const feeBld =
    input.feeDenomDecimals >= 0 ? Number(input.feeUbld) / 10 ** input.feeDenomDecimals : Number(input.feeUbld);
  return {
    gasPerTx: ratio(Number(input.gasUsed), Number(totalTxs)),
    feeBldPerSuccessfulTx: ratio(feeBld, Number(input.successfulTxs)),
    successfulTxsPerActiveAddress: ratio(Number(input.successfulTxs), input.activeAddresses),
    grossUsdPerActiveAddress:
      input.grossUsdTotal === null ? null : ratio(input.grossUsdTotal, input.activeAddresses),
  };
}

function formatCount(n: number | null, maximumFractionDigits: number): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits });
}

export function formatNormalizedRatios(v: NormalizedRatioValues): NormalizedRatioStrings {
  return {
    gasPerTx: formatCount(v.gasPerTx, 0),
    feeBldPerSuccessfulTx:
      v.feeBldPerSuccessfulTx === null ? "—" : `${formatCount(v.feeBldPerSuccessfulTx, 6)} BLD`,
    successfulTxsPerActiveAddress: formatCount(v.successfulTxsPerActiveAddress, 2),
    grossUsdPerActiveAddress:
      v.grossUsdPerActiveAddress === null ? "—" : formatUsdEstimate(v.grossUsdPerActiveAddress),
  };
}
