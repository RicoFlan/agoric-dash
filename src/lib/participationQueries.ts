/**
 * Participation aggregates over `participant_day` — semantics match {@link PARTICIPANT_ROLES}
 * and `participantRollupPolicy.ts`.
 *
 * Agoric module accounts are excluded from every count and from per-address volume totals via
 * `AGORIC_MODULE_ACCOUNT_ADDRESSES` (read-time filter; the indexer still writes every observed
 * address into `participant_day` / `address_volume_day` so the blocklist can evolve without
 * re-indexing).
 */
import { and, eq, gte, lte, notInArray, sql } from "drizzle-orm";
import { db, pool } from "@/db/client";
import { addressVolumeDay, participantDay } from "@/db/schema";
import { AGORIC_MODULE_ACCOUNT_ADDRESSES } from "@/lib/agoricModuleAccounts";
import { PARTICIPANT_ROLES } from "@/lib/participantRollupPolicy";

const MODULE_ACCOUNT_ADDRS: string[] = [...AGORIC_MODULE_ACCOUNT_ADDRESSES];

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
        eq(participantDay.role, PARTICIPANT_ROLES.SIGNER),
        gte(participantDay.day, fromDay),
        lte(participantDay.day, toDay),
        notInArray(participantDay.address, MODULE_ACCOUNT_ADDRS)
      )
    );

  const [feeRow] = await db
    .select({ c: sql<number>`count(distinct ${participantDay.address})::int` })
    .from(participantDay)
    .where(
      and(
        eq(participantDay.role, PARTICIPANT_ROLES.FEE_PAYER),
        gte(participantDay.day, fromDay),
        lte(participantDay.day, toDay),
        notInArray(participantDay.address, MODULE_ACCOUNT_ADDRS)
      )
    );

  const splitRes = await pool.query<{ single_d: string; multi_d: string }>(
    `WITH per AS (
       SELECT address, COUNT(DISTINCT day)::int AS da
       FROM participant_day
       WHERE day >= $1::date AND day <= $2::date
         AND address <> ALL($3::text[])
       GROUP BY address
     )
     SELECT
       COUNT(*) FILTER (WHERE da = 1)::text AS single_d,
       COUNT(*) FILTER (WHERE da > 1)::text AS multi_d
     FROM per`,
    [fromDay, toDay, MODULE_ACCOUNT_ADDRS]
  );
  const splitRow = splitRes.rows[0];

  const perDayRes = await pool.query<{ d: string; c: string }>(
    `SELECT day::text AS d, COUNT(DISTINCT address)::text AS c
     FROM participant_day
     WHERE day >= $1::date AND day <= $2::date
       AND address <> ALL($3::text[])
     GROUP BY day
     ORDER BY day`,
    [fromDay, toDay, MODULE_ACCOUNT_ADDRS]
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
    .where(
      and(
        gte(addressVolumeDay.day, fromDay),
        lte(addressVolumeDay.day, toDay),
        notInArray(addressVolumeDay.address, MODULE_ACCOUNT_ADDRS)
      )
    )
    .groupBy(addressVolumeDay.address, addressVolumeDay.denom);

  const volumeByAddressDenom = new Map<string, Map<string, bigint>>();
  for (const r of volRows) {
    if (!volumeByAddressDenom.has(r.address)) volumeByAddressDenom.set(r.address, new Map());
    volumeByAddressDenom.get(r.address)!.set(r.denom, BigInt(r.v ?? "0"));
  }

  return volumeByAddressDenom;
}
