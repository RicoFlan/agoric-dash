/**
 * Read path for YMax tables (P6). Principal deployed = Σ(total_in − total_out) over the latest
 * position records — cumulative, so it is a stock at "now" (the newest published height), not a
 * range figure; the range only scopes flows. A missing table (before the P6 deploy/seed) degrades
 * to `available: false` with empty data so the API keeps serving.
 */
import { pool } from "@/db/client";

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
  /** Newest published height across positions (freshness of the stock figure). */
  latestHeight: string | null;
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
         GROUP BY contract, protocol, chain, denom
         ORDER BY SUM(total_in - total_out) DESC`
      ),
      pool.query<{ with_positions: string; active: string; total: string }>(
        `SELECT
           (SELECT COUNT(DISTINCT (contract, portfolio)) FROM ymax_position)::text AS with_positions,
           (SELECT COUNT(*) FROM (SELECT contract, portfolio FROM ymax_position GROUP BY contract, portfolio HAVING SUM(total_in - total_out) > 0) a)::text AS active,
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
    return {
      available: true,
      portfoliosWithPositions: Number(counts.rows[0]?.with_positions ?? 0),
      portfoliosActive: Number(counts.rows[0]?.active ?? 0),
      portfoliosTotal: Number(counts.rows[0]?.total ?? 0),
      byVenue,
      flowsInRange: flows.rows.map((r) => ({ flowType: r.flow_type, denom: r.denom, count: Number(r.c), amount: r.amount })),
      latestHeight: latest,
    };
  } catch (e) {
    if ((e as { code?: string } | null)?.code === "42P01") {
      return { available: false, portfoliosWithPositions: 0, portfoliosActive: 0, portfoliosTotal: 0, byVenue: [], flowsInRange: [], latestHeight: null };
    }
    throw e;
  }
}
