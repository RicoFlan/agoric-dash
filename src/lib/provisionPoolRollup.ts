/**
 * Accumulate and persist `published.provisionPool.metrics` snapshots, one row per UTC day.
 *
 * Mirrors the YMax rollup's shape (accumulate per block, upsert latest-wins at flush) with one
 * deliberate difference: the key is the DAY, not an entity id, and the stored value is the last
 * cumulative reading on that day rather than a sum. A cumulative counter accumulated additively
 * would multiply on replay; keyed by day and upserted highest-height-wins, a replayed block either
 * rewrites the same row with the same value or loses to a later height. Idempotent either way, and
 * both the live indexer and the backfill can write the same day without coordination.
 */
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { parseCapData } from "@/lib/walletOfferMarshal";
import { extractProvisionPoolCapData, summarizeProvisionPoolMetrics } from "@/lib/provisionPoolVstorage";
import type { RpcBlockResultsResponse } from "@/lib/rpc";

type Db = NodePgDatabase<typeof schema>;

export interface ProvisionPoolDayRow {
  day: string;
  walletsProvisioned: number;
  totalMintedProvided: string;
  totalMintedConverted: string;
  brandBoardId: string | null;
  updatedHeight: bigint;
}

/** Day → the highest-height reading seen for that day so far. */
export class ProvisionPoolAccumulator {
  readonly days = new Map<string, ProvisionPoolDayRow>();

  get size(): number {
    return this.days.size;
  }

  /** Keep the reading from the greatest height; blocks may arrive out of order under concurrency. */
  observe(row: ProvisionPoolDayRow): void {
    const prev = this.days.get(row.day);
    if (prev && prev.updatedHeight >= row.updatedHeight) return;
    this.days.set(row.day, row);
  }
}

/**
 * Decode every metrics publication in a block into the accumulator. Never throws — a malformed
 * publication is skipped, because one bad cell must not stop the indexer for every other series.
 */
export function accumulateProvisionPoolFromBlock(
  results: RpcBlockResultsResponse,
  height: bigint,
  blockTimeIso: string,
  acc: ProvisionPoolAccumulator
): void {
  const day = blockTimeIso.slice(0, 10);
  if (day.length !== 10) return;
  for (const capData of extractProvisionPoolCapData(results.finalize_block_events ?? results.end_block_events)) {
    const snap = summarizeProvisionPoolMetrics(parseCapData(capData));
    // Both counters are required: a row missing either cannot be differenced against its
    // neighbours, and storing a partial row would silently poison the day's delta.
    if (!snap || snap.walletsProvisioned === null || snap.totalMintedProvided === null) continue;
    acc.observe({
      day,
      walletsProvisioned: snap.walletsProvisioned,
      totalMintedProvided: snap.totalMintedProvided,
      totalMintedConverted: snap.totalMintedConverted ?? "0",
      brandBoardId: snap.brandBoardId,
      updatedHeight: height,
    });
  }
}

/**
 * Upsert each day, highest height wins.
 *
 * The `WHERE excluded.updated_height > …` guard is what makes a backfill safe to run while the live
 * indexer is writing: a replay of an older height cannot overwrite a newer reading of the same day.
 */
export async function persistProvisionPool(db: Db, acc: ProvisionPoolAccumulator): Promise<void> {
  if (acc.size === 0) return;
  await db.transaction(async (tx) => {
    for (const r of acc.days.values()) {
      await tx
        .insert(schema.provisionPoolDay)
        .values({
          day: r.day,
          walletsProvisioned: r.walletsProvisioned,
          totalMintedProvided: r.totalMintedProvided,
          totalMintedConverted: r.totalMintedConverted,
          brandBoardId: r.brandBoardId,
          updatedHeight: r.updatedHeight,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [schema.provisionPoolDay.day],
          set: {
            walletsProvisioned: sql`excluded.wallets_provisioned`,
            totalMintedProvided: sql`excluded.total_minted_provided`,
            totalMintedConverted: sql`excluded.total_minted_converted`,
            brandBoardId: sql`excluded.brand_board_id`,
            updatedHeight: sql`excluded.updated_height`,
            updatedAt: sql`now()`,
          },
          setWhere: sql`excluded.updated_height > ${schema.provisionPoolDay.updatedHeight}`,
        });
    }
  });
}
