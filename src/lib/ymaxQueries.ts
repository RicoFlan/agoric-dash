/**
 * Read path for YMax tables (P6), with the P7.5 integrity disclosures.
 *
 * Net capital deployed = Σ(total_in − total_out) over the latest position records. Two honesty
 * constraints learned from production:
 *
 *  - A position whose total_out exceeds total_in produces NEGATIVE "principal", which means the
 *    quantity is not behaving as a position balance there (466 such rows on prod, −$41k). Netting
 *    them into the headline hides that, so they are quarantined and reported separately.
 *  - Positions republish only when they change, and their heights span millions of blocks. Old is
 *    not necessarily wrong, but the share of the figure resting on long-unpublished records must be
 *    visible, so freshness is reported against a threshold rather than a single "as of" height.
 *
 * A missing table (before the P6 deploy/seed) degrades to `available: false` so the API keeps serving.
 */
import { pool } from "@/db/client";

/**
 * Positions last published more than this many blocks before the newest observed position are
 * reported as stale. About 17 days at 6s blocks: long enough that an idle position is not flagged,
 * short enough that a genuinely abandoned record is.
 */
export const YMAX_STALE_THRESHOLD_BLOCKS = 250_000;

export interface YmaxPositionAgg {
  contract: string;
  protocol: string | null;
  chain: string | null;
  denom: string | null;
  positions: number;
  portfolios: number;
  /** Σ(total_in − total_out), atomic units of `denom` (string bigint; may be negative if data is partial). */
  principal: string;
  /** Newest published height among the aggregated positions. */
  latestHeight: string;
}

export interface YmaxFlowAgg {
  flowType: string;
  denom: string | null;
  count: number;
  /** Σ amount (atomic) for flows first seen in the range, or "0" when amounts are unknown. */
  amount: string;
}

export interface YmaxSnapshot {
  available: boolean;
  /** Portfolios with at least one position record. */
  portfoliosWithPositions: number;
  /** Portfolios with positive principal deployed. */
  portfoliosActive: number;
  portfoliosTotal: number;
  byVenue: YmaxPositionAgg[];
  /** Flows first seen in [fromDay, toDay]. */
  flowsInRange: YmaxFlowAgg[];
  /** Maximum observed position height (constituent positions may be older — see per-venue latestHeight). */
  latestHeight: string | null;
  /** Minimum observed position height: the staleness floor of the aggregate. */
  oldestHeight: string | null;
  /**
   * Positions where total_out exceeds total_in. Excluded from `byVenue` and from the headline,
   * because a negative "principal" means the quantity is not a position balance for that row.
   */
  quarantined: { positions: number; byDenom: { denom: string | null; amount: string }[] };
  /** Of the counted positions, those last published more than the threshold before `latestHeight`. */
  freshness: { staleThresholdBlocks: number; stalePositions: number; staleByDenom: { denom: string | null; amount: string }[] };
}

export async function queryYmaxSnapshot(fromDay: string, toDay: string): Promise<YmaxSnapshot> {
  try {
    const [venues, counts, flows] = await Promise.all([
      pool.query<{ contract: string; protocol: string | null; chain: string | null; denom: string | null; positions: string; portfolios: string; principal: string; latest: string }>(
        `SELECT contract, protocol, chain, denom,
                COUNT(*)::text AS positions,
                COUNT(DISTINCT portfolio)::text AS portfolios,
                SUM(total_in - total_out)::text AS principal,
                MAX(updated_height)::text AS latest
         FROM ymax_position
         WHERE total_in >= total_out
         GROUP BY contract, protocol, chain, denom
         ORDER BY SUM(total_in - total_out) DESC`
      ),
      pool.query<{ with_positions: string; active: string; total: string }>(
        `SELECT
           (SELECT COUNT(DISTINCT (contract, portfolio)) FROM ymax_position)::text AS with_positions,
           (SELECT COUNT(*) FROM (SELECT contract, portfolio FROM ymax_position WHERE total_in >= total_out GROUP BY contract, portfolio HAVING SUM(total_in - total_out) > 0) a)::text AS active,
           (SELECT COUNT(*) FROM ymax_portfolio)::text AS total`
      ),
      pool.query<{ flow_type: string; denom: string | null; c: string; amount: string }>(
        `SELECT flow_type, denom, COUNT(*)::text AS c, COALESCE(SUM(amount), 0)::text AS amount
         FROM ymax_flow
         WHERE day >= $1::date AND day <= $2::date
         GROUP BY flow_type, denom
         ORDER BY COUNT(*) DESC`,
        [fromDay, toDay]
      ),
    ]);
    const byVenue = venues.rows.map((r) => ({
      contract: r.contract,
      protocol: r.protocol,
      chain: r.chain,
      denom: r.denom,
      positions: Number(r.positions),
      portfolios: Number(r.portfolios),
      principal: r.principal,
      latestHeight: r.latest,
    }));
    let latest: string | null = null;
    for (const v of byVenue) if (latest === null || BigInt(v.latestHeight) > BigInt(latest)) latest = v.latestHeight;
    const oldestRow = await pool.query<{ oldest: string | null }>(`SELECT MIN(updated_height)::text AS oldest FROM ymax_position`);
    const oldestHeight = oldestRow.rows[0]?.oldest ?? null;

    const [quarantineRows, staleRows] = await Promise.all([
      pool.query<{ denom: string | null; amount: string; n: string }>(
        `SELECT denom, SUM(total_out - total_in)::text AS amount, COUNT(*)::text AS n
         FROM ymax_position WHERE total_in < total_out GROUP BY denom`
      ),
      pool.query<{ denom: string | null; amount: string; n: string }>(
        `SELECT denom, SUM(total_in - total_out)::text AS amount, COUNT(*)::text AS n
         FROM ymax_position
         WHERE total_in >= total_out
           AND updated_height < (SELECT MAX(updated_height) - $1::bigint FROM ymax_position)
         GROUP BY denom`,
        [YMAX_STALE_THRESHOLD_BLOCKS]
      ),
    ]);
    const quarantined = {
      positions: quarantineRows.rows.reduce((s, r) => s + Number(r.n), 0),
      byDenom: quarantineRows.rows.map((r) => ({ denom: r.denom, amount: r.amount })),
    };
    const freshness = {
      staleThresholdBlocks: YMAX_STALE_THRESHOLD_BLOCKS,
      stalePositions: staleRows.rows.reduce((s, r) => s + Number(r.n), 0),
      staleByDenom: staleRows.rows.map((r) => ({ denom: r.denom, amount: r.amount })),
    };
    return {
      available: true,
      portfoliosWithPositions: Number(counts.rows[0]?.with_positions ?? 0),
      portfoliosActive: Number(counts.rows[0]?.active ?? 0),
      portfoliosTotal: Number(counts.rows[0]?.total ?? 0),
      byVenue,
      flowsInRange: flows.rows.map((r) => ({ flowType: r.flow_type, denom: r.denom, count: Number(r.c), amount: r.amount })),
      latestHeight: latest,
      oldestHeight,
      quarantined,
      freshness,
    };
  } catch (e) {
    if ((e as { code?: string } | null)?.code === "42P01") {
      return {
        available: false,
        portfoliosWithPositions: 0,
        portfoliosActive: 0,
        portfoliosTotal: 0,
        byVenue: [],
        flowsInRange: [],
        latestHeight: null,
        oldestHeight: null,
        quarantined: { positions: 0, byDenom: [] },
        freshness: { staleThresholdBlocks: YMAX_STALE_THRESHOLD_BLOCKS, stalePositions: 0, staleByDenom: [] },
      };
    }
    throw e;
  }
}
