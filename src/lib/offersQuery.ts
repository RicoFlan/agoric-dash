/**
 * Distinct offer-submitting smart-wallet counts over `offer_participant_day` (day × owner × kind).
 *
 * This is the primary anti-overcounting signal for SwingSet/Zoe activity: a few automation wallets
 * dominate raw action counts, so distinct-wallet counts contextualize them. Daily-grain by table
 * design (like participation/concentration), regardless of the dashboard's selected granularity.
 */
import { pool } from "@/db/client";

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
