/**
 * Reads `provision_pool_day` for a range, plus the one snapshot immediately before it.
 *
 * The prior snapshot is not optional decoration. A day's activity is the difference from the
 * previous snapshot, so without the one before `fromDay` the first day in every range would report
 * null and its wallets would silently vanish from the range total. Fetching it is what makes a
 * windowed figure equal the sum of its days.
 */
import { pool } from "@/db/client";
import type { ProvisionPoolDaySnapshot } from "@/lib/provisioningSeries";

export interface ProvisioningSnapshots {
  /** Ascending by day, including one row before `fromDay` when one exists. */
  readonly snapshots: ProvisionPoolDaySnapshot[];
  /** Day of the leading prior snapshot, so the caller can exclude it from range totals. */
  readonly priorDay: string | null;
  /** False when the table does not exist yet — the indexer has not deployed or backfilled. */
  readonly available: boolean;
}

const EMPTY: ProvisioningSnapshots = { snapshots: [], priorDay: null, available: false };

export async function queryProvisioningSnapshots(fromDay: string, toDay: string): Promise<ProvisioningSnapshots> {
  try {
    const res = await pool.query<{ d: string; w: string; m: string }>(
      `(SELECT day::text AS d, wallets_provisioned::text AS w, total_minted_provided::text AS m
          FROM provision_pool_day WHERE day < $1::date ORDER BY day DESC LIMIT 1)
       UNION ALL
       (SELECT day::text, wallets_provisioned::text, total_minted_provided::text
          FROM provision_pool_day WHERE day >= $1::date AND day <= $2::date ORDER BY day)
       ORDER BY 1`,
      [fromDay, toDay]
    );
    const snapshots = res.rows.map((r) => ({
      day: String(r.d).slice(0, 10),
      walletsProvisioned: Number(r.w),
      totalMintedProvided: String(r.m),
    }));
    const priorDay = snapshots.length > 0 && snapshots[0]!.day < fromDay ? snapshots[0]!.day : null;
    return { snapshots, priorDay, available: true };
  } catch (e) {
    // Table absent before the additive create has run anywhere: report unavailable rather than
    // failing the whole metrics response, matching offersQuery's behaviour for its own table.
    if ((e as { code?: string } | null)?.code === "42P01") return EMPTY;
    throw e;
  }
}
