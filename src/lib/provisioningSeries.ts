/**
 * Turns the provision pool's cumulative snapshots into per-day new wallets and pool funding, and
 * reports how the two relate to the on-chain fee — which is NOT the validation the brief expected.
 *
 * The stored rows are the LAST cumulative counter observed on each day (see
 * provisionPoolVstorage.ts for why a cumulative source is snapshotted rather than accumulated). A
 * day's activity is therefore the difference from the previous day that has a snapshot — not the
 * previous calendar day, since a day with no publication has no row and must not be read as zero.
 *
 * **The fee cross-check does NOT work, and this is the finding.** `power_flag_fees` for
 * `SMART_WALLET` is 10 BLD, so the brief proposed that minted-BLD ÷ wallets should be 10 and the
 * two counters would validate each other. Checked against mainnet on 2026-09-20, they do not:
 *
 *   - **Cumulatively they disagree by 3.9×** — 1,453 wallets against 3,710,000,000 ubld minted,
 *     i.e. 2.55 BLD per wallet, where 10 BLD each would be 14,530,000,000.
 *   - **They do not even move together.** One `metrics` StreamCell holds two consecutive
 *     publications: 1452 wallets / 3,710,000,000 ubld, then 1453 wallets / 3,710,000,000 ubld. A
 *     wallet was provisioned with no minting at all, and the 10 BLD before it was minted with no
 *     wallet. The pool tops itself up and spends later, so the counters are decoupled in time as
 *     well as in total.
 *
 * `totalMintedProvided` is a FUNDING counter, not a per-wallet cost: it records what the pool had
 * to mint, and a wallet funded from an existing balance advances the wallet count alone. It cannot
 * validate `walletsProvisioned`, at any granularity.
 *
 * The implied rate is still computed and still worth showing — as a disclosed observation about the
 * pool's funding, never as a check that either number is right. `matchesFee` records where it
 * departs from 10 BLD so a reader sees the disagreement rather than a smoothed average; on this
 * chain it will depart often, and that is the true picture rather than a fault.
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
   * Expect plenty of `false`: the counters are decoupled (see the module comment), so this marks
   * where the pool's funding and its provisioning diverged, not where the data is wrong.
   */
  readonly matchesFee: boolean | null;
  /** UTC days skipped between this snapshot and the previous one (no publication on those days). */
  readonly gapDays: number;
}

/** `power_flag_fees` SMART_WALLET on agoric-3: 10 BLD in ubld. */
export const SMART_WALLET_FEE_UBLD = 10_000_000;

const MS_PER_DAY = 86_400_000;

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
    const implied = sane && newWallets > 0 ? Number(minted) / newWallets / 1e6 : null;
    out.push({
      day: cur.day,
      newWallets: sane ? newWallets : null,
      mintedUbld: sane ? minted.toString() : null,
      impliedBldPerWallet: implied,
      matchesFee:
        implied === null
          ? null
          : Math.abs(implied * 1e6 - SMART_WALLET_FEE_UBLD) <= SMART_WALLET_FEE_UBLD * tolerance,
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
