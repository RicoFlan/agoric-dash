/**
 * Reads `bundle_install` for a range: contract landings, and the storage fees they paid.
 *
 * **Availability is coverage, not table existence** — the same rule as provisioningQuery.ts, and
 * it matters more here. Bundle installs are rare, so an uncovered range looks exactly like a quiet
 * one: both are zero rows. Without a coverage check, "the backfill has not run" would render as
 * "no contracts landed", which is the failure the coverage floors exist to prevent.
 *
 * Coverage comes from the backfill checkpoint, which records the chain tip the run searched up to
 * — not the height of the last install found. Those differ by design: the meaningful statement is
 * "we looked as far as here", and a long quiet stretch after the last install must still count as
 * covered.
 */
import { pool } from "@/db/client";

/** Must match `JOB` in scripts/backfillBundleInstalls.ts. */
export const BUNDLE_INSTALL_BACKFILL_JOB = "bundle_install";

export interface ContractLandingDay {
  readonly day: string;
  readonly installs: number;
  /** Swingset storage fee for the day, atomic ubld integer string. */
  readonly storageFeeUbld: string;
  /** Ordinary gas fee on those same txs, ubld — already inside `fee_paid`. */
  readonly gasFeeUbld: string;
}

export interface ContractLandings {
  readonly daily: readonly ContractLandingDay[];
  readonly installs: number;
  readonly storageFeeUbld: string;
  readonly gasFeeUbld: string;
  /** Distinct fee payers that landed a contract in the range. */
  readonly distinctInstallers: number;
  readonly available: boolean;
  readonly unavailableReason: "not-backfilled" | "range-exceeds-coverage" | null;
  readonly coveredThroughDay: string | null;
}

const unavailable = (
  reason: "not-backfilled" | "range-exceeds-coverage",
  coveredThroughDay: string | null = null
): ContractLandings => ({
  daily: [],
  installs: 0,
  storageFeeUbld: "0",
  gasFeeUbld: "0",
  distinctInstallers: 0,
  available: false,
  unavailableReason: reason,
  coveredThroughDay,
});

export async function queryContractLandings(fromDay: string, toDay: string): Promise<ContractLandings> {
  try {
    // The checkpoint's `updated_at` IS the covered-through day: the run searched to the chain tip
    // at that moment, so every day up to it was looked at — whether or not an install was found.
    // Deriving the day from the newest install instead would end coverage at the last landing and
    // report every quiet day since as unknown, which is the opposite of what was observed.
    const cov = await pool.query<{ covered: string | null }>(
      `SELECT updated_at::date::text AS covered FROM backfill_checkpoint WHERE job = $1`,
      [BUNDLE_INSTALL_BACKFILL_JOB]
    );
    const coveredThroughDay = cov.rows[0]?.covered ? String(cov.rows[0].covered).slice(0, 10) : null;
    if (!coveredThroughDay) return unavailable("not-backfilled");
    if (toDay > coveredThroughDay) return unavailable("range-exceeds-coverage", coveredThroughDay);

    const res = await pool.query<{ d: string; n: string; s: string; g: string }>(
      `SELECT day::text AS d, COUNT(*)::text AS n,
              COALESCE(SUM(storage_fee_ubld), 0)::text AS s,
              COALESCE(SUM(gas_fee_ubld), 0)::text AS g
         FROM bundle_install
        WHERE day >= $1::date AND day <= $2::date
        GROUP BY day ORDER BY day`,
      [fromDay, toDay]
    );
    const installers = await pool.query<{ n: string }>(
      `SELECT COUNT(DISTINCT installer)::text AS n
         FROM bundle_install
        WHERE day >= $1::date AND day <= $2::date AND installer IS NOT NULL`,
      [fromDay, toDay]
    );

    const daily = res.rows.map((r) => ({
      day: String(r.d).slice(0, 10),
      installs: Number(r.n),
      storageFeeUbld: String(r.s),
      gasFeeUbld: String(r.g),
    }));
    const sum = (pick: (d: ContractLandingDay) => string) =>
      daily.reduce((n, d) => n + BigInt(pick(d)), BigInt(0)).toString();

    return {
      daily,
      installs: daily.reduce((n, d) => n + d.installs, 0),
      storageFeeUbld: sum((d) => d.storageFeeUbld),
      gasFeeUbld: sum((d) => d.gasFeeUbld),
      distinctInstallers: Number(installers.rows[0]?.n ?? "0"),
      available: true,
      unavailableReason: null,
      coveredThroughDay,
    };
  } catch (e) {
    if ((e as { code?: string } | null)?.code === "42P01") return unavailable("not-backfilled");
    throw e;
  }
}
