import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db, pool } from "@/db/client";
import { addressVolumeDay, participantDay } from "@/db/schema";

const SIGNER = "signer";
const FEE_PAYER = "fee_payer";

export type ParticipationRangeStats = {
  distinctSigners: number;
  distinctFeePayers: number;
  singleDayAddresses: number;
  multiDayAddresses: number;
  distinctUnionPerDay: { day: string; count: number }[];
};

export async function queryParticipationRange(
  fromDay: string,
  toDay: string
): Promise<ParticipationRangeStats> {
  const [signerRow] = await db
    .select({ c: sql<number>`count(distinct ${participantDay.address})::int` })
    .from(participantDay)
    .where(
      and(
        eq(participantDay.role, SIGNER),
        gte(participantDay.day, fromDay),
        lte(participantDay.day, toDay)
      )
    );

  const [feeRow] = await db
    .select({ c: sql<number>`count(distinct ${participantDay.address})::int` })
    .from(participantDay)
    .where(
      and(
        eq(participantDay.role, FEE_PAYER),
        gte(participantDay.day, fromDay),
        lte(participantDay.day, toDay)
      )
    );

  const splitRes = await pool.query<{ single_d: string; multi_d: string }>(
    `WITH per AS (
       SELECT address, COUNT(DISTINCT day)::int AS da
       FROM participant_day
       WHERE day >= $1::date AND day <= $2::date
       GROUP BY address
     )
     SELECT
       COUNT(*) FILTER (WHERE da = 1)::text AS single_d,
       COUNT(*) FILTER (WHERE da > 1)::text AS multi_d
     FROM per`,
    [fromDay, toDay]
  );
  const splitRow = splitRes.rows[0];

  const perDayRes = await pool.query<{ d: string; c: string }>(
    `SELECT day::text AS d, COUNT(DISTINCT address)::text AS c
     FROM participant_day
     WHERE day >= $1::date AND day <= $2::date
     GROUP BY day
     ORDER BY day`,
    [fromDay, toDay]
  );

  return {
    distinctSigners: Number(signerRow?.c ?? 0),
    distinctFeePayers: Number(feeRow?.c ?? 0),
    singleDayAddresses: Number(splitRow?.single_d ?? 0),
    multiDayAddresses: Number(splitRow?.multi_d ?? 0),
    distinctUnionPerDay: perDayRes.rows.map((r) => ({
      day: String(r.d).slice(0, 10),
      count: Number(r.c),
    })),
  };
}

/** Per-address aggregate transfer volume by denom for concentration (sender-side indexed legs). */
export async function queryAddressVolumeTotals(
  fromDay: string,
  toDay: string
): Promise<Map<string, Map<string, bigint>>> {
  const volRows = await db
    .select({
      address: addressVolumeDay.address,
      denom: addressVolumeDay.denom,
      v: sql<string>`sum(${addressVolumeDay.volume})::text`,
    })
    .from(addressVolumeDay)
    .where(and(gte(addressVolumeDay.day, fromDay), lte(addressVolumeDay.day, toDay)))
    .groupBy(addressVolumeDay.address, addressVolumeDay.denom);

  const volumeByAddressDenom = new Map<string, Map<string, bigint>>();
  for (const r of volRows) {
    if (!volumeByAddressDenom.has(r.address)) volumeByAddressDenom.set(r.address, new Map());
    volumeByAddressDenom.get(r.address)!.set(r.denom, BigInt(r.v ?? "0"));
  }

  return volumeByAddressDenom;
}
