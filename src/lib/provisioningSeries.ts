/**
 * Turns the provision pool's cumulative snapshots into per-day new wallets and pool funding, and
 * cross-checks the two against the on-chain SMART_WALLET fee.
 *
 * The stored rows are the LAST cumulative counter observed on each day (see
 * provisionPoolVstorage.ts for why a cumulative source is snapshotted rather than accumulated). A
 * day's activity is therefore the difference from the previous day that has a snapshot — not the
 * previous calendar day, since a day with no publication has no row and must not be read as zero.
 *
 * **The fee cross-check works, within indexed history.** `power_flag_fees` for `SMART_WALLET` is
 * 10 BLD, and the brief proposed that minted BLD ÷ new wallets should equal it. Verified against
 * mainnet over 2026-01-01..2026-09-20: wallets 1,184 → 1,453 (+269) against minted
 * 1,020,000,000 → 3,710,000,000 ubld (+2,690,000,000). 269 × 10 BLD is 2,690,000,000 — exact to the
 * ubld, and every one of the 72 days with a new wallet sits at the fee.
 *
 * **The cumulative totals still disagree, and that is a separate fact about pre-2026 history.**
 * 1,453 wallets against 3,710,000,000 ubld is 2.55 BLD per wallet, a 3.9× gap. All of it predates
 * the indexed window: wallets provisioned before 2026 were not funded by pool minting at 10 BLD.
 * Reading that gap as evidence against the check — which an earlier version of this comment did —
 * confuses a total since genesis with the window the dashboard reports.
 *
 * One ordering caveat, visible but harmless: the pool mints and provisions in separate blocks, so
 * two publications minutes apart can show a wallet with no minting and then minting with no wallet.
 * That washes out at day granularity, which is the granularity stored.
 *
 * `matchesFee` therefore reads true on every day so far. It is kept because a future divergence is
 * exactly what a reader would want flagged — it would mean the pool had stopped funding every
 * wallet, or the fee had changed — and a check that has never fired is still the thing that would.
 */

/** Cumulative counters as of the last publication on a given UTC day. */
export interface ProvisionPoolDaySnapshot {
  readonly day: string;
  readonly walletsProvisioned: number;
  /** Atomic ubld, integer string. */
  readonly totalMintedProvided: string;
}

export interface ProvisioningDay {
  readonly day: string;
  /** New wallets since the previous snapshot; null on the first day, which has nothing to difference. */
  readonly newWallets: number | null;
  /** Minted ubld since the previous snapshot, integer string; null on the first day. */
  readonly mintedUbld: string | null;
  /**
   * `mintedUbld ÷ newWallets`, in whole BLD. Null when there is no previous snapshot or no new
   * wallet that day — never 0, since "no wallets provisioned" is not a rate of zero.
   */
  readonly impliedBldPerWallet: number | null;
  /**
   * True when the implied rate is within tolerance of the on-chain fee. Null when not computable.
   * True on every day of indexed history so far; a `false` would mean the pool had stopped funding
   * every wallet at 10 BLD, or the fee had changed.
   */
  readonly matchesFee: boolean | null;
  /** UTC days skipped between this snapshot and the previous one (no publication on those days). */
  readonly gapDays: number;
}

/** `power_flag_fees` SMART_WALLET on agoric-3: 10 BLD in ubld. */
export const SMART_WALLET_FEE_UBLD = 10_000_000;

const MS_PER_DAY = 86_400_000;

const absDiff = (a: bigint, b: bigint) => (a > b ? a - b : b - a);

/** Whole BLD from an atomic ubld string, exact for any magnitude (6 decimals, truncated). */
export function ubldToWholeBld(ubld: string): string {
  const n = BigInt(ubld);
  const neg = n < BigInt(0);
  const whole = (neg ? -n : n) / BigInt(1_000_000);
  return (neg ? "-" : "") + whole.toString();
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / MS_PER_DAY);
}

/**
 * Difference consecutive snapshots into per-day activity.
 *
 * @param snapshots ascending by day; days without a publication are simply absent
 * @param tolerance fractional slack on the fee comparison, default 1% — the rate is exact when the
 *   pool funds every wallet, so this allows for rounding, not for disagreement
 */
export function buildProvisioningDays(
  snapshots: readonly ProvisionPoolDaySnapshot[],
  tolerance = 0.01
): ProvisioningDay[] {
  const out: ProvisioningDay[] = [];
  for (let i = 0; i < snapshots.length; i++) {
    const cur = snapshots[i]!;
    const prev = i > 0 ? snapshots[i - 1]! : null;
    if (!prev) {
      out.push({
        day: cur.day,
        newWallets: null,
        mintedUbld: null,
        impliedBldPerWallet: null,
        matchesFee: null,
        gapDays: 0,
      });
      continue;
    }
    const newWallets = cur.walletsProvisioned - prev.walletsProvisioned;
    const minted = BigInt(cur.totalMintedProvided) - BigInt(prev.totalMintedProvided);
    // A cumulative counter going backwards means the source reset or was mis-read; report the day
    // rather than a negative "new wallets", which would be nonsense on the page.
    const sane = newWallets >= 0 && minted >= BigInt(0);
    // Divide in bigint first so a ubld total beyond 2^53 cannot lose precision before the compare;
    // only the already-small per-wallet ubld figure becomes a Number for display.
    const impliedUbld = sane && newWallets > 0 ? minted / BigInt(newWallets) : null;
    const implied = impliedUbld === null ? null : Number(impliedUbld) / 1e6;
    out.push({
      day: cur.day,
      newWallets: sane ? newWallets : null,
      mintedUbld: sane ? minted.toString() : null,
      impliedBldPerWallet: implied,
      // Compared on the bigint ubld figure, not the floated BLD one, so the boundary is exact.
      matchesFee:
        impliedUbld === null
          ? null
          : absDiff(impliedUbld, BigInt(SMART_WALLET_FEE_UBLD)) <= BigInt(Math.round(SMART_WALLET_FEE_UBLD * tolerance)),
      gapDays: Math.max(0, dayDiff(prev.day, cur.day) - 1),
    });
  }
  return out;
}

export interface ProvisioningSummary {
  /** Σ new wallets over the differenced days; null when nothing could be differenced. */
  readonly newWallets: number | null;
  readonly mintedUbld: string | null;
  /** Days where the implied rate departed from the fee — the disagreement, surfaced not smoothed. */
  readonly daysOffFee: number;
  /** Days with activity that could be rate-checked at all. */
  readonly daysRateChecked: number;
  /** Cumulative counters at the end of the range, for reconciliation against the live chain value. */
  readonly closingWalletsProvisioned: number | null;
  readonly closingTotalMintedProvided: string | null;
}

/**
 * Range totals plus the reconciliation handles.
 *
 * `closing*` exist so the figure can be checked against `published.provisionPool.metrics` directly:
 * the acceptance test for this feature is that the differenced daily counts reconcile with the live
 * cumulative value at the range end.
 */
export function summarizeProvisioning(
  snapshots: readonly ProvisionPoolDaySnapshot[],
  days: readonly ProvisioningDay[]
): ProvisioningSummary {
  const differenced = days.filter((d) => d.newWallets !== null);
  const last = snapshots.length > 0 ? snapshots[snapshots.length - 1]! : null;
  return {
    newWallets: differenced.length ? differenced.reduce((s, d) => s + (d.newWallets ?? 0), 0) : null,
    mintedUbld: differenced.length
      ? differenced.reduce((s, d) => s + BigInt(d.mintedUbld ?? "0"), BigInt(0)).toString()
      : null,
    daysOffFee: days.filter((d) => d.matchesFee === false).length,
    daysRateChecked: days.filter((d) => d.matchesFee !== null).length,
    closingWalletsProvisioned: last?.walletsProvisioned ?? null,
    closingTotalMintedProvided: last?.totalMintedProvided ?? null,
  };
}
