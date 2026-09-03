/**
 * Accumulate YMax state from a block's finalize events into latest-state upserts, and persist them.
 * Shared by the indexer (per chunk), the snapshot seed, and the EndBlock backfill so all three write
 * identical rows. Latest-wins by height: a chunk that carries several updates for the same key keeps
 * the highest height; persistence only overwrites rows with an older `updated_height`.
 */
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { brandDenom } from "@/lib/agoricInstanceNames";
import type { RpcBlockResultsResponse } from "@/lib/rpc";
import { parseCapData } from "@/lib/walletOfferMarshal";
import {
  extractYmaxStreamCells,
  summarizeFlow,
  summarizePortfolio,
  summarizePosition,
  YMAX_TERMINAL_FLOW_STATES,
} from "@/lib/ymaxVstorage";

type Db = NodePgDatabase<typeof schema>;

export interface YmaxPortfolioRow {
  contract: string;
  portfolio: string;
  depositAddress: string | null;
  agoricAccount: string | null;
  accountsJson: string;
  policyVersion: number | null;
  flowCount: number | null;
  updatedHeight: bigint;
}
export interface YmaxPositionRow {
  contract: string;
  portfolio: string;
  positionKey: string;
  protocol: string | null;
  chain: string | null;
  accountId: string | null;
  denom: string | null;
  totalIn: string;
  totalOut: string;
  netTransfers: string;
  updatedHeight: bigint;
}
export interface YmaxFlowRow {
  contract: string;
  portfolio: string;
  flowId: string;
  flowType: string;
  denom: string | null;
  amount: string | null;
  day: string;
  firstHeight: bigint;
  lastState: string | null;
  lastHeight: bigint;
}

/** In-memory accumulation for one chunk (or one snapshot). Keys are `contract\0portfolio[\0key]`. */
export class YmaxAccumulator {
  readonly portfolios = new Map<string, YmaxPortfolioRow>();
  readonly positions = new Map<string, YmaxPositionRow>();
  readonly flows = new Map<string, YmaxFlowRow>();

  get size(): number {
    return this.portfolios.size + this.positions.size + this.flows.size;
  }

  /** Apply one decoded update at `height` (UTC `day` of that block). */
  applyDecoded(path: ReturnType<typeof extractYmaxStreamCells>[number]["path"], decoded: unknown, height: bigint, day: string): void {
    if (path.kind === "portfolio") {
      const s = summarizePortfolio(decoded);
      if (!s) return;
      const k = `${path.contract}\0${path.portfolio}`;
      const prev = this.portfolios.get(k);
      if (!prev || prev.updatedHeight <= height) {
        this.portfolios.set(k, {
          contract: path.contract,
          portfolio: path.portfolio,
          depositAddress: s.depositAddress,
          agoricAccount: s.agoricAccount,
          accountsJson: JSON.stringify(s.accountIdByChain).slice(0, 4096),
          policyVersion: s.policyVersion,
          flowCount: s.flowCount,
          updatedHeight: height,
        });
      }
      // Flows are announced (with amounts) on the status record; first sighting defines the flow.
      for (const f of s.flowsRunning) {
        const fk = `${path.contract}\0${path.portfolio}\0${f.flowId}`;
        const existing = this.flows.get(fk);
        if (existing) {
          if (existing.lastHeight < height) existing.lastHeight = height;
          if (!existing.amount && f.amount) {
            existing.amount = f.amount.value;
            existing.denom = brandDenom(f.amount.brandBoardId);
          }
          continue;
        }
        this.flows.set(fk, {
          contract: path.contract,
          portfolio: path.portfolio,
          flowId: f.flowId,
          flowType: f.type,
          denom: f.amount ? brandDenom(f.amount.brandBoardId) : null,
          amount: f.amount?.value ?? null,
          day,
          firstHeight: height,
          lastState: "run",
          lastHeight: height,
        });
      }
    } else if (path.kind === "position") {
      const s = summarizePosition(decoded, path.key);
      if (!s) return;
      const k = `${path.contract}\0${path.portfolio}\0${path.key}`;
      const prev = this.positions.get(k);
      if (!prev || prev.updatedHeight <= height) {
        this.positions.set(k, {
          contract: path.contract,
          portfolio: path.portfolio,
          positionKey: path.key,
          protocol: s.protocol,
          chain: s.chain,
          accountId: s.accountId,
          denom: brandDenom(s.brandBoardId),
          totalIn: s.totalIn,
          totalOut: s.totalOut,
          netTransfers: s.netTransfers,
          updatedHeight: height,
        });
      }
    } else if (path.kind === "flow") {
      const s = summarizeFlow(decoded);
      if (!s) return;
      const fk = `${path.contract}\0${path.portfolio}\0${path.flowId}`;
      const existing = this.flows.get(fk);
      if (existing) {
        if (existing.lastHeight <= height) {
          existing.lastHeight = height;
          existing.lastState = s.state;
        }
      } else {
        // Progress update for a flow whose announcement was in an earlier chunk (or before our
        // window): record it type-less; persistence only touches last_state/last_height then.
        this.flows.set(fk, {
          contract: path.contract,
          portfolio: path.portfolio,
          flowId: path.flowId,
          flowType: "unknown",
          denom: null,
          amount: null,
          day,
          firstHeight: height,
          lastState: s.state,
          lastHeight: height,
        });
      }
    }
  }
}

function dayUtc(isoTime: string): string {
  return new Date(isoTime).toISOString().slice(0, 10);
}

/** Decode every YMax cell in a block's finalize events into the accumulator. Never throws. */
export function accumulateYmaxFromBlock(
  results: RpcBlockResultsResponse,
  height: bigint,
  blockTimeIso: string,
  acc: YmaxAccumulator
): void {
  const events = results.finalize_block_events ?? results.end_block_events;
  const cells = extractYmaxStreamCells(events);
  if (cells.length === 0) return;
  const day = dayUtc(blockTimeIso);
  for (const cell of cells) {
    for (const capDataString of cell.capDataStrings) {
      let decoded: unknown;
      try {
        decoded = parseCapData(capDataString);
      } catch {
        continue;
      }
      acc.applyDecoded(cell.path, decoded, height, day);
    }
  }
}

/** Upsert the accumulator (latest-wins by updated_height / last_height). */
export async function persistYmax(db: Db, acc: YmaxAccumulator): Promise<void> {
  if (acc.size === 0) return;
  await db.transaction(async (tx) => {
    for (const r of acc.portfolios.values()) {
      await tx
        .insert(schema.ymaxPortfolio)
        .values({ ...r, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [schema.ymaxPortfolio.contract, schema.ymaxPortfolio.portfolio],
          set: {
            depositAddress: sql`excluded.deposit_address`,
            agoricAccount: sql`excluded.agoric_account`,
            accountsJson: sql`excluded.accounts_json`,
            policyVersion: sql`excluded.policy_version`,
            flowCount: sql`excluded.flow_count`,
            updatedHeight: sql`excluded.updated_height`,
            updatedAt: sql`now()`,
          },
          setWhere: sql`${schema.ymaxPortfolio.updatedHeight} <= excluded.updated_height`,
        });
    }
    for (const r of acc.positions.values()) {
      await tx
        .insert(schema.ymaxPosition)
        .values({ ...r, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [schema.ymaxPosition.contract, schema.ymaxPosition.portfolio, schema.ymaxPosition.positionKey],
          set: {
            protocol: sql`excluded.protocol`,
            chain: sql`excluded.chain`,
            accountId: sql`excluded.account_id`,
            denom: sql`excluded.denom`,
            totalIn: sql`excluded.total_in`,
            totalOut: sql`excluded.total_out`,
            netTransfers: sql`excluded.net_transfers`,
            updatedHeight: sql`excluded.updated_height`,
            updatedAt: sql`now()`,
          },
          setWhere: sql`${schema.ymaxPosition.updatedHeight} <= excluded.updated_height`,
        });
    }
    for (const r of acc.flows.values()) {
      await tx
        .insert(schema.ymaxFlow)
        .values(r)
        .onConflictDoUpdate({
          target: [schema.ymaxFlow.contract, schema.ymaxFlow.portfolio, schema.ymaxFlow.flowId],
          set: {
            // Keep the first sighting's type/amount/day; a later progress-only row must not blank them.
            flowType: sql`CASE WHEN ${schema.ymaxFlow.flowType} = 'unknown' THEN excluded.flow_type ELSE ${schema.ymaxFlow.flowType} END`,
            denom: sql`COALESCE(${schema.ymaxFlow.denom}, excluded.denom)`,
            amount: sql`COALESCE(${schema.ymaxFlow.amount}, excluded.amount)`,
            day: sql`LEAST(${schema.ymaxFlow.day}, excluded.day)`,
            firstHeight: sql`LEAST(${schema.ymaxFlow.firstHeight}, excluded.first_height)`,
            lastState: sql`CASE WHEN excluded.last_height >= ${schema.ymaxFlow.lastHeight} THEN excluded.last_state ELSE ${schema.ymaxFlow.lastState} END`,
            lastHeight: sql`GREATEST(${schema.ymaxFlow.lastHeight}, excluded.last_height)`,
          },
        });
    }
  });
}

export { YMAX_TERMINAL_FLOW_STATES };
