/**
 * Accumulate bundle installs per block and persist them one row per transaction.
 *
 * Unlike every additive rollup here, this one is idempotent by construction: the key is the tx
 * hash, so re-indexing a block rewrites the same row with the same numbers. No checkpoint
 * arithmetic, no FULL-vs-RESUME mode, and the backfill can run while the live indexer writes.
 *
 * The upsert overwrites rather than ignoring conflicts, so a corrected extraction can be replayed
 * over old rows — but the values are derived from immutable block events, so in practice a rewrite
 * is a no-op.
 */
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { amountOf, extractBundleInstallCharge, hasBundleInstall, isAmbiguousInstallTx } from "@/lib/bundleInstallFees";
import type { EventKV } from "@/lib/cosmos";

type Db = NodePgDatabase<typeof schema>;

export interface BundleInstallRow {
  txHash: string;
  height: bigint;
  day: string;
  installer: string | null;
  gasFeeUbld: string;
  /** Null when the tx was mixed and the fee cannot be attributed to the install. */
  storageFeeUbld: string | null;
}

export class BundleInstallAccumulator {
  readonly rows = new Map<string, BundleInstallRow>();

  get size(): number {
    return this.rows.size;
  }

  add(row: BundleInstallRow): void {
    this.rows.set(row.txHash, row);
  }
}

/**
 * Record one transaction if it installs a bundle.
 *
 * Callers reach this only for SUCCESSFUL txs — a failed one discards its message events and never
 * gets its body decoded, so a failed install cannot be observed at all (see schema.ts).
 *
 * Returns true when a row was added, so the caller can log without re-deriving the condition.
 * Never throws: a malformed event set yields zero fees rather than stopping the block.
 */
export function accumulateBundleInstall(
  acc: BundleInstallAccumulator,
  params: {
    txHash: string;
    height: bigint;
    day: string;
    typeUrls: readonly string[];
    events: readonly EventKV[];
  }
): boolean {
  if (!hasBundleInstall(params.typeUrls)) return false;
  const charge = extractBundleInstallCharge(params.events);
  acc.add({
    txHash: params.txHash,
    height: params.height,
    day: params.day,
    installer: charge.feePayer,
    gasFeeUbld: amountOf(charge.gasFee).toString(),
    // A mixed tx records the install but withholds the fee, rather than inflating it.
    storageFeeUbld: isAmbiguousInstallTx(params.typeUrls) ? null : amountOf(charge.storageFee).toString(),
  });
  return true;
}

export async function persistBundleInstalls(db: Db, acc: BundleInstallAccumulator): Promise<void> {
  if (acc.size === 0) return;
  await db.transaction(async (tx) => {
    for (const r of acc.rows.values()) {
      await tx
        .insert(schema.bundleInstall)
        .values({
          txHash: r.txHash,
          height: r.height,
          day: r.day,
          installer: r.installer,
          gasFeeUbld: r.gasFeeUbld,
          storageFeeUbld: r.storageFeeUbld,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [schema.bundleInstall.txHash],
          set: {
            height: sql`excluded.height`,
            day: sql`excluded.day`,
            installer: sql`excluded.installer`,
            gasFeeUbld: sql`excluded.gas_fee_ubld`,
            storageFeeUbld: sql`excluded.storage_fee_ubld`,
            updatedAt: sql`now()`,
          },
        });
    }
  });
}
