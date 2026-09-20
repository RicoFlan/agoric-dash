/**
 * Reads `provision_pool_day` for a range, plus the one snapshot immediately before it.
 *
 * The prior snapshot is not optional decoration. A day's activity is the difference from the
 * previous snapshot, so without the one before `fromDay` the first day in every range would report
 * null and its wallets would silently vanish from the range total. Fetching it is what makes a
 * windowed figure equal the sum of its days.
 *
 * **Availability is coverage, not table existence.** An empty table, or one holding only the rows
 * the live indexer has written since deploy, would otherwise report `available: true` and present a
 * partial count as a complete one — the same "not indexed rendered as zero" failure the coverage
 * floors exist to prevent, in a new place. Coverage is taken from the backfill checkpoint: the
 * backfill records how far it has replayed, so a range is covered only up to that point.
 */
import { pool } from "@/db/client";
import type { ProvisionPoolDaySnapshot } from "@/lib/provisioningSeries";

/** Must match `JOB` in scripts/backfillProvisionPool.ts. */
export const PROVISION_POOL_BACKFILL_JOB = "provision_pool";

export interface ProvisioningSnapshots {
  /** Ascending by day, including one row before `fromDay` when one exists. */
  readonly snapshots: ProvisionPoolDaySnapshot[];
  /** Day of the leading prior snapshot, so the caller can exclude it from range totals. */
  readonly priorDay: string | null;
  /**
   * True only when the backfill has replayed history AND the requested range sits within what it
   * covered. False means the figures would be partial, and the UI must say so rather than show them.
   */
  readonly available: boolean;
  /** Why it is unavailable, for an honest note on the page. Null when available. */
  readonly unavailableReason: "not-backfilled" | "range-exceeds-coverage" | null;
  /** UTC day the backfill has replayed through, when it has run. */
  readonly coveredThroughDay: string | null;
}

const unavailable = (
  reason: "not-backfilled" | "range-exceeds-coverage",
  coveredThroughDay: string | null = null
): ProvisioningSnapshots => ({ snapshots: [], priorDay: null, available: false, unavailableReason: reason, coveredThroughDay });

export async function queryProvisioningSnapshots(fromDay: string, toDay: string): Promise<ProvisioningSnapshots> {
  try {
    // The checkpoint's height is translated to a day by the newest row the backfill wrote at or
    // below it; that row's day is the last day whose snapshot is known complete.
    const cov = await pool.query<{ covered: string | null }>(
      `SELECT MAX(d.day)::text AS covered
         FROM provision_pool_day d
         JOIN backfill_checkpoint c ON c.job = $1
        WHERE d.updated_height <= c.last_height`,
      [PROVISION_POOL_BACKFILL_JOB]
    );
    const coveredThroughDay = cov.rows[0]?.covered ? String(cov.rows[0].covered).slice(0, 10) : null;
    if (!coveredThroughDay) return unavailable("not-backfilled");
    // Asking beyond what was replayed would mix backfilled days with whatever the live indexer
    // happened to catch, and present the total as if the whole range were covered.
    if (toDay > coveredThroughDay) return unavailable("range-exceeds-coverage", coveredThroughDay);

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
    return { snapshots, priorDay, available: true, unavailableReason: null, coveredThroughDay };
  } catch (e) {
    // Either table absent before the additive create has run: unavailable rather than a failed
    // metrics response, matching offersQuery's behaviour for its own table.
    if ((e as { code?: string } | null)?.code === "42P01") return unavailable("not-backfilled");
    throw e;
  }
}
