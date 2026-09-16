/**
 * Distinct offer-submitting smart-wallet counts over `offer_participant_day` (day × owner × kind).
 *
 * This is the primary anti-overcounting signal for SwingSet/Zoe activity: a few automation wallets
 * dominate raw action counts, so distinct-wallet counts contextualize them. Daily-grain by table
 * design (like participation/concentration), regardless of the dashboard's selected granularity.
 */
import { pool } from "@/db/client";
import { categoryAutomation, OFFER_CATEGORIES } from "@/lib/offerCategory";

export interface OfferParticipantStats {
  /** Distinct wallets that submitted any wallet action in range. */
  distinctWallets: number;
  /** Distinct wallets that submitted a Zoe offer (executeOffer/tryExitOffer). */
  distinctZoeOfferWallets: number;
  /** Distinct wallets that submitted a wallet invocation (invokeEntry). */
  distinctInvocationWallets: number;
  /** Distinct submitting wallets per UTC day (union across kinds). */
  perDay: { day: string; count: number }[];
}

export async function queryOfferParticipantsRange(
  fromDay: string,
  toDay: string
): Promise<OfferParticipantStats> {
  const totals = await pool.query<{ all_w: string; zoe_w: string; inv_w: string }>(
    `SELECT
       COUNT(DISTINCT address)::text AS all_w,
       COUNT(DISTINCT address) FILTER (WHERE kind = 'zoe_offer')::text AS zoe_w,
       COUNT(DISTINCT address) FILTER (WHERE kind = 'wallet_invocation')::text AS inv_w
     FROM offer_participant_day
     WHERE day >= $1::date AND day <= $2::date`,
    [fromDay, toDay]
  );
  const t = totals.rows[0];

  const perDay = await pool.query<{ d: string; c: string }>(
    `SELECT day::text AS d, COUNT(DISTINCT address)::text AS c
     FROM offer_participant_day
     WHERE day >= $1::date AND day <= $2::date
     GROUP BY day
     ORDER BY day`,
    [fromDay, toDay]
  );

  return {
    distinctWallets: Number(t?.all_w ?? 0),
    distinctZoeOfferWallets: Number(t?.zoe_w ?? 0),
    distinctInvocationWallets: Number(t?.inv_w ?? 0),
    perDay: perDay.rows.map((r) => ({ day: String(r.d).slice(0, 10), count: Number(r.c) })),
  };
}

export interface OfferCategoryParticipantStats {
  /** Distinct wallets that submitted at least one action in an interactive category (vaults, PSM, auction, governance). */
  distinctInteractiveWallets: number;
  /** Distinct wallets that submitted at least one action in an automated category (orchestration, oracle, fast-USDC). */
  distinctAutomatedWallets: number;
  /** Distinct wallets with ≥1 action in ANY category — the denominator for the wallet-weighted share. */
  distinctCategorizedWallets: number;
  /**
   * Distinct wallets that acted in BOTH an interactive and an automated category. Such a wallet is
   * counted in the interactive numerator, so this is the size of the overlap the share absorbs.
   */
  distinctMixedWallets: number;
  /** Distinct wallets per category. */
  byCategory: Record<string, number>;
  /** False when `offer_category_participant_day` does not exist yet (pre-deploy / pre-backfill) — counts are then 0, not "none". */
  available: boolean;
}

/**
 * Distinct wallets per functional category over `offer_category_participant_day` (day × owner ×
 * category). The interactive/automated split reuses `categoryAutomation()` so it stays a read-time
 * relabel. A missing table (before the P2 indexer deploy + backfill) yields zeros with
 * `available: false` rather than an error, so the API keeps serving.
 */
export async function queryOfferCategoryParticipantsRange(
  fromDay: string,
  toDay: string
): Promise<OfferCategoryParticipantStats> {
  const interactive = OFFER_CATEGORIES.filter((c) => categoryAutomation(c) === "interactive");
  const automated = OFFER_CATEGORIES.filter((c) => categoryAutomation(c) === "automated");
  try {
    const [split, per] = await Promise.all([
      pool.query<{ inter: string; auto: string; any_w: string; mixed: string }>(
        `WITH w AS (
           SELECT address,
                  bool_or(category = ANY($3::text[])) AS has_interactive,
                  bool_or(category = ANY($4::text[])) AS has_automated
           FROM offer_category_participant_day
           WHERE day >= $1::date AND day <= $2::date
           GROUP BY address
         )
         SELECT
           COUNT(*) FILTER (WHERE has_interactive)::text AS inter,
           COUNT(*) FILTER (WHERE has_automated)::text AS auto,
           COUNT(*)::text AS any_w,
           COUNT(*) FILTER (WHERE has_interactive AND has_automated)::text AS mixed
         FROM w`,
        [fromDay, toDay, interactive, automated]
      ),
      pool.query<{ category: string; c: string }>(
        `SELECT category, COUNT(DISTINCT address)::text AS c
         FROM offer_category_participant_day
         WHERE day >= $1::date AND day <= $2::date
         GROUP BY category`,
        [fromDay, toDay]
      ),
    ]);
    const byCategory: Record<string, number> = {};
    for (const r of per.rows) byCategory[r.category] = Number(r.c);
    return {
      distinctInteractiveWallets: Number(split.rows[0]?.inter ?? 0),
      distinctAutomatedWallets: Number(split.rows[0]?.auto ?? 0),
      distinctCategorizedWallets: Number(split.rows[0]?.any_w ?? 0),
      distinctMixedWallets: Number(split.rows[0]?.mixed ?? 0),
      byCategory,
      available: true,
    };
  } catch (e) {
    if ((e as { code?: string } | null)?.code === "42P01") {
      return {
        distinctInteractiveWallets: 0,
        distinctAutomatedWallets: 0,
        distinctCategorizedWallets: 0,
        distinctMixedWallets: 0,
        byCategory: {},
        available: false,
      };
    }
    throw e;
  }
}
