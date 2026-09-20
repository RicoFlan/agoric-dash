/**
 * Standalone indexer: polls RPC for block + block_results, updates daily_metrics,
 * hourly_metrics, participant_day, address_volume_day, and address_fee_day
 * (hour bucket from block time UTC for hourly_metrics).
 *
 * Source hierarchy (events vs decoded body): see `src/lib/rollupSourceHierarchy.ts`. In short: ABCI
 * fields for outcomes/gas; **fee_paid** from tx events; bank / outbound ICS-20 **amounts** from
 * decoded `Msg*` bodies; **IBC recv amounts** deduped per denom across `coin_received` / `transfer` events per successful recv tx (`sumRecvCoinAmountsDedupedFromTxEvents` — single-count basis, not the 2× combined sum; see `docs/ibcTransferAmountInEventInvestigation.md`);
 * **`ibc_transfer_flow_in`** from recv_packet events when present, else MsgRecvPacket count.
 *
 * Scope: only **`block_results.txs_results`** are processed — not standalone finalize-block / BeginBlock /
 * EndBlock event streams (`src/lib/indexerIngestScope.ts`). Chain upgrades may require decode/event tweaks
 * (`src/lib/protocolCompatibilityNotes.ts`).
 * Run: DATABASE_URL=... RPC_URL=... tsx scripts/indexer.ts
 */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { EncodeObject } from "@cosmjs/proto-signing";
import { fromBase64 } from "@cosmjs/encoding";
import pg from "pg";
import * as schema from "../src/db/schema";
import { decodeMsg, decodeTxRawTx, extractFeePayerFromEvents, extractPaidFeesFromEvents } from "../src/lib/cosmos";
import { attributedTransferLegsFromDecodedMsg } from "../src/lib/transferVolumeAttribution";
import { PARTICIPANT_ROLES } from "../src/lib/participantRollupPolicy";
import {
  feePayerBech32FromAuthInfo,
  signerBech32AddressesFromAuthInfo,
} from "../src/lib/txParticipantAddresses";
import {
  describeTxResultsLengthMismatch,
  pairedTxCount,
} from "../src/lib/blockTxResultsPairing";
import { rpcCallWithFallback, type RpcBlockResponse, type RpcBlockResultsResponse } from "../src/lib/rpc";
import { addIbcTransferFlowInForTx } from "../src/lib/ibcTransferFlowInRollup";
import { maxGasFromBlockResults } from "../src/lib/blockGasLimit";
import { stakingGovSeriesForTypeUrl } from "../src/lib/stakingGovMsgTypes";
import { parseCapData } from "../src/lib/walletOfferMarshal";
import { walletActionRollupDeltas } from "../src/lib/walletOfferRollup";
import {
  drainResolutionWarning,
  newResolutionWarnings,
  recordResolution,
} from "../src/lib/offerResolutionWarnings";
import { extractWalletStreamCells, summarizeOfferStatus } from "../src/lib/walletOutcomeSummary";
import { refreshDailyPrices } from "../src/lib/coingecko/priceRefresh";
import { ensureOfferCategoryParticipantDayTable, ensureYmaxTables } from "../src/db/ensureAdditiveTables";
import { accumulateYmaxFromBlock, persistYmax, YmaxAccumulator } from "../src/lib/ymaxRollup";
import {
  accumulateProvisionPoolFromBlock,
  persistProvisionPool,
  ProvisionPoolAccumulator,
} from "../src/lib/provisionPoolRollup";
import { endBlockIbcSends } from "../src/lib/endBlockIbc";
import { decodeWalletAction, offerCategoryOf } from "../src/lib/walletActionDecode";
import { outcomeCategoryDim, OUTCOME_CATEGORY_UNCLASSIFIED } from "../src/lib/offerOutcomeCategory";
import { brandDenom, instanceName } from "../src/lib/agoricInstanceNames";
import { sumRecvCoinAmountsDedupedFromTxEvents } from "../src/lib/ibcRecvEventAmounts";
import { addBankCreditsForTx } from "../src/lib/bankCreditsRollup";
import { isAgoricModuleAccount } from "../src/lib/agoricModuleAccounts";
import { msgIndicesMatchingTypeUrl } from "../src/lib/txEventMsgIndex";
import {
  formatNewTypeUrlLog,
  noteFirstSeenTypeUrl,
} from "../src/lib/typeUrlObservability";
import {
  MSG_IBC_TRANSFER,
  MSG_RECV_PACKET,
  SERIES,
  TRANSFER_MSG_TYPES,
  TX_SUCCESS_CODE,
  WALLET_ACTION_MSG_TYPES,
} from "../src/lib/semantics";

const DATABASE_URL = process.env.DATABASE_URL;
/** Daily CoinGecko price refresh (denom_price_day): interval, history depth per run, kill switch. */
function envNumber(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return process.env[name] !== undefined && Number.isFinite(n) ? n : fallback;
}
const PRICE_REFRESH_MS = Math.max(60_000, envNumber("PRICE_REFRESH_MS", 6 * 60 * 60 * 1000));
const PRICE_REFRESH_DAYS = Math.max(1, Math.min(365, envNumber("PRICE_REFRESH_DAYS", 3)));
const PRICE_REFRESH_DISABLED = ["1", "true", "yes"].includes((process.env.PRICE_REFRESH_DISABLED ?? "").trim().toLowerCase());
/**
 * Primary CometBFT RPC. Defaults to the canonical Agoric mainnet RPC when unset.
 * `RPC_URL_FALLBACK` is opt-in; when set, each call tries primary first and
 * fails over per-call (no sticky state) — see {@link rpcCallWithFallback}.
 */
const RPC_URL_PRIMARY = process.env.RPC_URL ?? "https://main-a.rpc.agoric.net";
const RPC_URL_FALLBACK = process.env.RPC_URL_FALLBACK ?? "";
const RPC_URLS: readonly string[] = [RPC_URL_PRIMARY, RPC_URL_FALLBACK];
const POLL_MS = Number(process.env.INDEXER_POLL_MS ?? "20000");
const BATCH = Number(process.env.INDEXER_BATCH ?? "25");
const LAG = Number(process.env.INDEXER_LAG ?? "3");
const INITIAL_WINDOW = BigInt(process.env.INDEXER_INITIAL_WINDOW ?? "500");
const START_DATE_ISO = process.env.INDEXER_START_DATE ?? "2026-01-01T00:00:00Z";
const CATCHUP_BATCH = Number(process.env.INDEXER_CATCHUP_BATCH ?? "2000");
const CATCHUP_POLL_MS = Number(process.env.INDEXER_CATCHUP_POLL_MS ?? "100");
const CATCHUP_THRESHOLD_BLOCKS = BigInt(process.env.INDEXER_CATCHUP_THRESHOLD_BLOCKS ?? "20000");
/** Parallel block fetches in catch-up mode (each height still does block + block_results). */
const CATCHUP_CONCURRENCY = Math.max(
  1,
  Math.min(128, Number(process.env.INDEXER_CATCHUP_CONCURRENCY ?? "24"))
);

if (!DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema });

const {
  dailyMetrics,
  hourlyMetrics,
  participantDay,
  addressVolumeDay,
  addressFeeDay,
  offerParticipantDay,
  offerCategoryParticipantDay,
} = schema;

/**
 * In-memory set of message typeUrls observed in successfully decoded txs since this
 * indexer process started. Used purely for first-seen diagnostic logging via
 * `noteFirstSeenTypeUrl`; not persisted, not read by downstream rollup logic.
 */
const observedTypeUrls = new Set<string>();

const START_DATE_MS = new Date(START_DATE_ISO).getTime();
if (!Number.isFinite(START_DATE_MS)) {
  console.error("INDEXER_START_DATE must be a valid ISO datetime, e.g. 2026-01-01T00:00:00Z");
  process.exit(1);
}

function dayUtc(isoTime: string): string {
  const d = new Date(isoTime);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Truncate block time to the UTC hour for hourly_metrics */
function hourStartUtcFromIso(isoTime: string): Date {
  const d = new Date(isoTime);
  d.setUTCMilliseconds(0);
  d.setUTCSeconds(0);
  d.setUTCMinutes(0);
  return d;
}

const ROLLUP_KEY_DELIM = "\0";

function bumpRollupMap(m: Map<string, bigint>, key: string, delta: bigint) {
  if (delta === BigInt(0)) return;
  m.set(key, (m.get(key) ?? BigInt(0)) + delta);
}

function addRollupDelta(
  daily: Map<string, bigint>,
  hourly: Map<string, bigint>,
  day: string,
  hour: Date,
  series: string,
  dimension: string,
  delta: bigint
) {
  if (delta === BigInt(0)) return;
  bumpRollupMap(daily, [day, series, dimension].join(ROLLUP_KEY_DELIM), delta);
  bumpRollupMap(hourly, [hour.toISOString(), series, dimension].join(ROLLUP_KEY_DELIM), delta);
}

function noteParticipant(
  day: string,
  address: string,
  role: "signer" | "fee_payer",
  participantTriples: Set<string>
) {
  participantTriples.add([day, address, role].join(ROLLUP_KEY_DELIM));
}

function bumpAddrDenom(
  m: Map<string, bigint>,
  day: string,
  address: string,
  denom: string,
  delta: bigint
) {
  if (delta === BigInt(0)) return;
  const key = [day, address, denom].join(ROLLUP_KEY_DELIM);
  m.set(key, (m.get(key) ?? BigInt(0)) + delta);
}

/**
 * Persist one processed chunk atomically: rollups + participation + cursor.
 * Previously rollups, participants, and `indexer_state` used separate transactions; a crash or RPC
 * error after the first commit but before `setCursor` caused the same heights to be processed again,
 * and `onConflictDoUpdate` **adds** deltas → double-counted metrics and misleading “gaps” vs chain.
 */
async function persistIndexedChunk(
  daily: Map<string, bigint>,
  hourly: Map<string, bigint>,
  participantTriples: Set<string>,
  volumeDeltas: Map<string, bigint>,
  feeDeltas: Map<string, bigint>,
  offerParticipantTriples: Set<string>,
  offerCategoryParticipantTriples: Set<string>,
  lastIndexedHeight: bigint
) {
  await db.transaction(async (tx) => {
    for (const [key, delta] of daily) {
      if (delta === BigInt(0)) continue;
      const [day, series, dimension] = key.split(ROLLUP_KEY_DELIM);
      const dStr = delta.toString();
      await tx
        .insert(dailyMetrics)
        .values({ day, series, dimension, value: dStr })
        .onConflictDoUpdate({
          target: [dailyMetrics.day, dailyMetrics.series, dailyMetrics.dimension],
          set: { value: sql`${dailyMetrics.value} + ${sql.raw("excluded.value")}` },
        });
    }
    for (const [key, delta] of hourly) {
      if (delta === BigInt(0)) continue;
      const [iso, series, dimension] = key.split(ROLLUP_KEY_DELIM);
      const hour = new Date(iso);
      const dStr = delta.toString();
      await tx
        .insert(hourlyMetrics)
        .values({ hour, series, dimension, value: dStr })
        .onConflictDoUpdate({
          target: [hourlyMetrics.hour, hourlyMetrics.series, hourlyMetrics.dimension],
          set: { value: sql`${hourlyMetrics.value} + ${sql.raw("excluded.value")}` },
        });
    }
    for (const key of participantTriples) {
      const [day, address, role] = key.split(ROLLUP_KEY_DELIM);
      await tx.insert(participantDay).values({ day, address, role }).onConflictDoNothing();
    }
    for (const key of offerParticipantTriples) {
      const [day, address, kind] = key.split(ROLLUP_KEY_DELIM);
      await tx.insert(offerParticipantDay).values({ day, address, kind }).onConflictDoNothing();
    }
    for (const key of offerCategoryParticipantTriples) {
      const [day, address, category] = key.split(ROLLUP_KEY_DELIM);
      await tx.insert(offerCategoryParticipantDay).values({ day, address, category }).onConflictDoNothing();
    }
    for (const [key, delta] of volumeDeltas) {
      if (delta === BigInt(0)) continue;
      const [day, address, denom] = key.split(ROLLUP_KEY_DELIM);
      const dStr = delta.toString();
      await tx
        .insert(addressVolumeDay)
        .values({ day, address, denom, volume: dStr })
        .onConflictDoUpdate({
          target: [addressVolumeDay.day, addressVolumeDay.address, addressVolumeDay.denom],
          set: { volume: sql`${addressVolumeDay.volume} + ${sql.raw("excluded.volume")}` },
        });
    }
    for (const [key, delta] of feeDeltas) {
      if (delta === BigInt(0)) continue;
      const [day, address, denom] = key.split(ROLLUP_KEY_DELIM);
      const dStr = delta.toString();
      await tx
        .insert(addressFeeDay)
        .values({ day, address, denom, fee: dStr })
        .onConflictDoUpdate({
          target: [addressFeeDay.day, addressFeeDay.address, addressFeeDay.denom],
          set: { fee: sql`${addressFeeDay.fee} + ${sql.raw("excluded.fee")}` },
        });
    }

    await tx
      .insert(schema.indexerState)
      .values({
        id: "singleton",
        lastIndexedHeight: lastIndexedHeight,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.indexerState.id,
        set: { lastIndexedHeight: lastIndexedHeight, updatedAt: new Date() },
      });
  });
}

async function getCursor(): Promise<bigint> {
  const rows = await db
    .select()
    .from(schema.indexerState)
    .where(eq(schema.indexerState.id, "singleton"))
    .limit(1);
  return rows[0]?.lastIndexedHeight ?? BigInt(0);
}

function asEventKV(
  txs: RpcBlockResultsResponse["txs_results"]
): Array<Array<{ type: string; attributes: { key: string; value: string }[] }>> {
  if (!txs) return [];
  return txs.map((tx) =>
    (tx.events ?? []).map((e) => ({
      type: e.type,
      attributes: (e.attributes ?? []).map((a) => ({
        key: a.key,
        value: a.value,
      })),
    }))
  );
}

const RPC_RETRIES = Math.max(1, Number(process.env.INDEXER_RPC_RETRIES ?? "6"));

async function fetchBlockPair(height: bigint): Promise<{
  block: RpcBlockResponse;
  results: RpcBlockResultsResponse;
}> {
  const hStr = height.toString();
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RPC_RETRIES; attempt++) {
    try {
      const [block, results] = await Promise.all([
        rpcCallWithFallback<RpcBlockResponse>(RPC_URLS, "block", { height: hStr }),
        rpcCallWithFallback<RpcBlockResultsResponse>(RPC_URLS, "block_results", { height: hStr }),
      ]);
      return { block, results };
    } catch (e) {
      lastErr = e;
      const backoff = Math.min(30_000, 400 * 2 ** (attempt - 1));
      console.warn(
        `RPC height ${hStr} attempt ${attempt}/${RPC_RETRIES} failed: ${e instanceof Error ? e.message : String(e)}; retry in ${backoff}ms`
      );
      if (attempt < RPC_RETRIES) await sleep(backoff);
    }
  }
  throw lastErr;
}

/**
 * SwingSet/Zoe smart-wallet offer intent (successful txs): decode the marshalled CapData action body
 * and roll up objective dimensions (kind / source / instance / maker / target). Records the
 * submitting smart-wallet owner for distinct-wallet counts. Never throws — undecodable bodies are
 * still counted as wallet_actions[unknown] so real activity is not dropped.
 */
/**
 * Category-resolution decay, accumulated across the run and logged periodically. agoricNames.json
 * goes stale silently — a redeployed contract gets a new Board id and its offers become `other` with
 * nothing failing — so the indexer says so rather than letting the unclassified share drift.
 */
const resolutionWarnings = newResolutionWarnings();
let lastResolutionLogMs = 0;
const RESOLUTION_LOG_INTERVAL_MS = 15 * 60_000;

/** Log the accumulated resolution problems at most once per interval; silent when there are none. */
export function logResolutionWarningsIfDue(nowMs: number = Date.now()): void {
  if (nowMs - lastResolutionLogMs < RESOLUTION_LOG_INTERVAL_MS) return;
  // Drains as it formats, so each line reports ITS interval — a cumulative counter could not say
  // whether the problem is current, and would keep reporting stale failures after a map refresh.
  const msg = drainResolutionWarning(resolutionWarnings);
  lastResolutionLogMs = nowMs;
  if (msg) console.warn(msg);
}

function accumulateWalletAction(
  daily: Map<string, bigint>,
  hourly: Map<string, bigint>,
  day: string,
  hour: Date,
  enc: EncodeObject,
  offerParticipantTriples: Set<string>,
  offerCategoryParticipantTriples: Set<string>,
  hStr: string,
  i: number
) {
  const decoded = decodeWalletAction(enc);
  if (!decoded) {
    console.warn(`wallet-action decode failed height ${hStr} idx ${i}`);
    return;
  }
  const { owner, summary, instanceName: resolvedInstanceName, category } = decoded;
  recordResolution(resolutionWarnings, {
    instanceBoardId: summary.instanceBoardId,
    instanceName: resolvedInstanceName,
    maker: summary.maker,
    category,
  });
  for (const d of walletActionRollupDeltas(summary, resolvedInstanceName)) {
    addRollupDelta(daily, hourly, day, hour, d.series, d.dimension, BigInt(1));
  }
  if (summary.kind === "zoe_offer") {
    addLegVolumes(daily, hourly, day, hour, SERIES.OFFER_GIVE_VOLUME, summary.give);
    addLegVolumes(daily, hourly, day, hour, SERIES.OFFER_WANT_VOLUME, summary.want);
  }
  if (owner) {
    offerParticipantTriples.add([day, owner, summary.kind].join(ROLLUP_KEY_DELIM));
    offerCategoryParticipantTriples.add([day, owner, category].join(ROLLUP_KEY_DELIM));
  }
}

/**
 * Sum proposal/payout amount legs into a denom-keyed volume series for USD valuation. Only legs whose
 * brand resolves to a vbank denom (agoricNames.json vbankAssets) and carry a non-negative integer
 * value are included; everything else is skipped so the read path can reuse denom-based pricing.
 */
function addLegVolumes(
  daily: Map<string, bigint>,
  hourly: Map<string, bigint>,
  day: string,
  hour: Date,
  series: string,
  legs: ReadonlyArray<{ brandBoardId: string | null; value: string | null }>
) {
  for (const leg of legs) {
    const denom = brandDenom(leg.brandBoardId);
    if (!denom || !leg.value || !/^\d+$/.test(leg.value)) continue;
    addRollupDelta(daily, hourly, day, hour, series, denom, BigInt(leg.value));
  }
}

/**
 * Settled Zoe offer outcomes (block-grain): scan this block's finalize_block_events for vstorage
 * `published.wallet.<addr>` offerStatus updates and roll up exactly one terminal outcome per offer.
 * EndBlock vstorage events — outside tx_results scope, so this runs once per block independent of
 * tx success. Never throws; undecodable updates are skipped.
 */
function accumulateBlockOutcomes(
  results: RpcBlockResultsResponse,
  daily: Map<string, bigint>,
  hourly: Map<string, bigint>,
  day: string,
  hour: Date
) {
  const events = results.finalize_block_events ?? results.end_block_events;
  for (const cell of extractWalletStreamCells(events)) {
    for (const capDataString of cell.capDataStrings) {
      const fact = summarizeOfferStatus(parseCapData(capDataString));
      if (fact) {
        addRollupDelta(daily, hourly, day, hour, SERIES.OFFER_OUTCOME, fact.outcome, BigInt(1));
        const category = fact.spec ? offerCategoryOf(fact.spec, instanceName(fact.spec.instanceBoardId)) : OUTCOME_CATEGORY_UNCLASSIFIED;
        addRollupDelta(daily, hourly, day, hour, SERIES.OFFER_OUTCOME_CATEGORY, outcomeCategoryDim(category, fact.outcome), BigInt(1));
        addLegVolumes(daily, hourly, day, hour, SERIES.OFFER_PAYOUT_VOLUME, fact.payouts);
      }
    }
  }
}

function accumulateBlock(
  block: RpcBlockResponse,
  results: RpcBlockResultsResponse,
  daily: Map<string, bigint>,
  hourly: Map<string, bigint>,
  participantTriples: Set<string>,
  volumeDeltas: Map<string, bigint>,
  feeDeltas: Map<string, bigint>,
  offerParticipantTriples: Set<string>,
  offerCategoryParticipantTriples: Set<string>,
  ymaxAcc: YmaxAccumulator,
  provisionAcc: ProvisionPoolAccumulator
) {
  const hStr = block.block.header.height;
  const iso = block.block.header.time;
  const day = dayUtc(iso);
  const hour = hourStartUtcFromIso(iso);
  const txsB64 = block.block.data?.txs ?? [];
  const txResults = results.txs_results ?? [];
  const eventsPerTx = asEventKV(txResults);

  const blockTxCount = txsB64.length;
  const resultsCount = txResults.length;
  const mismatchDetail = describeTxResultsLengthMismatch(blockTxCount, resultsCount);
  if (mismatchDetail) {
    console.warn(`height ${hStr}: ${mismatchDetail}`);
  }

  // Block-space utilization denominator: per-block consensus max_gas (once per block, any tx outcome).
  const maxGas = maxGasFromBlockResults(results);
  if (maxGas !== null) {
    addRollupDelta(daily, hourly, day, hour, SERIES.BLOCK_GAS_LIMIT, "", maxGas);
  }

  // Settled Zoe offer outcomes (block-grain, EndBlock vstorage offerStatus events).
  accumulateBlockOutcomes(results, daily, hourly, day, hour);
  // YMax published state (portfolios / positions / flows) from the same vstorage events.
  accumulateYmaxFromBlock(results, BigInt(hStr), iso, ymaxAcc);
  // Provision-pool cumulative counters — snapshotted per day, not accumulated (they are cumulative).
  accumulateProvisionPoolFromBlock(results, BigInt(hStr), iso, provisionAcc);
  // Orchestration IBC sends (EndBlock send_packet) — outside tx scope, disjoint from MsgTransfer.
  for (const s of endBlockIbcSends(results.finalize_block_events ?? results.end_block_events)) {
    addRollupDelta(daily, hourly, day, hour, SERIES.IBC_TRANSFER_AMOUNT_OUT_ORCH, s.denom, s.amount);
    addRollupDelta(daily, hourly, day, hour, SERIES.IBC_TRANSFER_OUT_COUNT_ORCH, "", BigInt(1));
  }

  const n = pairedTxCount(blockTxCount, resultsCount);

  for (let i = 0; i < n; i++) {
    const raw = fromBase64(txsB64[i]!);
    const tr = txResults[i]!;
    const ok = tr.code === TX_SUCCESS_CODE;

    // Tx outcome: exactly one of tx_success / tx_failed per matched pair (TX_RESULT_ROLLUP_POLICY).
    addRollupDelta(daily, hourly, day, hour, ok ? SERIES.TX_SUCCESS : SERIES.TX_FAILED, "", BigInt(1));

    // Gas: every inclusion (success + failure). Fees and decoded-body metrics only below after `continue`.
    const gas = BigInt(tr.gas_used ?? "0");
    addRollupDelta(daily, hourly, day, hour, SERIES.GAS_USED, "", gas);
    const gasWanted = BigInt(tr.gas_wanted ?? "0");
    addRollupDelta(daily, hourly, day, hour, SERIES.GAS_WANTED, "", gasWanted);

    /**
     * fee_paid: tx_result events (`tx.fee`), not AuthInfo.max fees — see SERIES_ROLLUP_SOURCE.
     * Counted for FAILED txs too. A Cosmos fee is deducted by the ante handler and committed even
     * when message execution later fails, and the events reflect that: an ante failure emits no
     * `fee` attribute at all, while a post-ante failure emits the fee that was actually taken. So
     * this needs no special-casing; ante failures naturally contribute nothing.
     */
    const fees = extractPaidFeesFromEvents(eventsPerTx[i] ?? []);
    for (const [denom, amt] of fees) {
      addRollupDelta(daily, hourly, day, hour, SERIES.FEE_PAID, denom, amt);
    }
    if (!ok) {
      // Attribute a failed tx's committed fee from the event's own `fee_payer`; the body may not
      // decode, and we skip the decoded-body rollups below for failures anyway.
      const failedPayer = fees.size > 0 ? extractFeePayerFromEvents(eventsPerTx[i] ?? []) : null;
      if (failedPayer) {
        for (const [denom, amt] of fees) bumpAddrDenom(feeDeltas, day, failedPayer, denom, amt);
      }
      continue;
    }

    // bank_credits_volume: shared helper used by indexer + backfillBankCreditsVolume.ts.
    // Captures value moved via smart-contract / vbank flows that decoded-Msg-body sums
    // (transfer_volume) miss. See metricDictionary.ts and bankCreditsRollup.ts.
    addBankCreditsForTx(daily, hourly, day, hour, eventsPerTx[i] ?? [], isAgoricModuleAccount);

    let decoded;
    try {
      decoded = decodeTxRawTx(raw);
    } catch (e) {
      console.warn(`decode failed height ${hStr} idx ${i}:`, e);
      continue;
    }

    for (const s of signerBech32AddressesFromAuthInfo(decoded.authInfo)) {
      noteParticipant(day, s, PARTICIPANT_ROLES.SIGNER, participantTriples);
    }
    const feePayer = feePayerBech32FromAuthInfo(decoded.authInfo);
    if (feePayer) {
      noteParticipant(day, feePayer, PARTICIPANT_ROLES.FEE_PAYER, participantTriples);
      for (const [denom, amt] of fees) {
        bumpAddrDenom(feeDeltas, day, feePayer, denom, amt);
      }
    }

    // transfer_volume, ibc out count/amount: decoded Msg* intent — see SERIES_ROLLUP_SOURCE.
    const msgs = decoded.body.messages;

    for (const msg of msgs) {
      const t = (msg as EncodeObject).typeUrl;
      if (noteFirstSeenTypeUrl(observedTypeUrls, t)) {
        console.warn(formatNewTypeUrlLog(t, hStr, i));
      }
    }

    let recvPacketCount = 0;
    for (const msg of msgs) {
      if ((msg as EncodeObject).typeUrl === MSG_RECV_PACKET) recvPacketCount += 1;
    }

    for (const msg of msgs) {
      const enc = msg as EncodeObject;
      const typeUrl = enc.typeUrl;

      // Staking & governance activity: count by message typeUrl (no body decode needed).
      const sgSeries = stakingGovSeriesForTypeUrl(typeUrl);
      if (sgSeries) {
        addRollupDelta(daily, hourly, day, hour, sgSeries, "", BigInt(1));
      }

      // SwingSet/Zoe smart-wallet offer intent: decode CapData body, count objective dimensions.
      if (WALLET_ACTION_MSG_TYPES.has(typeUrl)) {
        accumulateWalletAction(daily, hourly, day, hour, enc, offerParticipantTriples, offerCategoryParticipantTriples, hStr, i);
      }

      if (!TRANSFER_MSG_TYPES.has(typeUrl)) {
        continue;
      }

      try {
        const decodedMsg = decodeMsg(enc) as {
          amount?: Array<{ denom: string; amount: string }>;
          outputs?: Array<{ coins: Array<{ denom: string; amount: string }> }>;
          token?: { denom: string; amount: string };
        };

        for (const leg of attributedTransferLegsFromDecodedMsg(typeUrl, decodedMsg)) {
          bumpAddrDenom(volumeDeltas, day, leg.address, leg.denom, leg.amount);
        }

        if (typeUrl.includes("MsgSend")) {
          for (const c of decodedMsg.amount ?? []) {
            const amt = BigInt(c.amount);
            addRollupDelta(daily, hourly, day, hour, SERIES.TRANSFER_VOLUME, c.denom, amt);
          }
        }
        if (typeUrl.includes("MsgMultiSend")) {
          for (const o of decodedMsg.outputs ?? []) {
            for (const c of o.coins ?? []) {
              const amt = BigInt(c.amount);
              addRollupDelta(daily, hourly, day, hour, SERIES.TRANSFER_VOLUME, c.denom, amt);
            }
          }
        }
        if (typeUrl === MSG_IBC_TRANSFER && decodedMsg.token) {
          addRollupDelta(
            daily,
            hourly,
            day,
            hour,
            SERIES.TRANSFER_VOLUME,
            decodedMsg.token.denom,
            BigInt(decodedMsg.token.amount)
          );
          addRollupDelta(daily, hourly, day, hour, SERIES.IBC_TRANSFER_OUT_COUNT, "", BigInt(1));
          addRollupDelta(
            daily,
            hourly,
            day,
            hour,
            SERIES.IBC_TRANSFER_AMOUNT_OUT,
            decodedMsg.token.denom,
            BigInt(decodedMsg.token.amount)
          );
        }
      } catch {
        /* ignore malformed */
      }
    }

    // IBC recv: ibc_transfer_amount_in + flow_in use tx events (recv_packet / coin_received); gated by MsgRecvPacket presence.
    if (recvPacketCount > 0) {
      const recvPacketMsgIndices = msgIndicesMatchingTypeUrl(
        msgs as ReadonlyArray<{ typeUrl: string }>,
        MSG_RECV_PACKET
      );
      addRollupDelta(
        daily,
        hourly,
        day,
        hour,
        SERIES.IBC_TRANSFER_IN_COUNT,
        "",
        BigInt(recvPacketCount)
      );
      addIbcTransferFlowInForTx(daily, hourly, day, hour, eventsPerTx[i] ?? [], recvPacketCount);
      for (const [denom, amt] of sumRecvCoinAmountsDedupedFromTxEvents(eventsPerTx[i] ?? [], {
        recvPacketMsgIndices: recvPacketMsgIndices,
      })) {
        addRollupDelta(daily, hourly, day, hour, SERIES.IBC_TRANSFER_AMOUNT_IN, denom, amt);
      }
    }
  }
}

async function latestHeight(): Promise<bigint> {
  const st = await rpcCallWithFallback<{ sync_info: { latest_block_height: string } }>(
    RPC_URLS,
    "status",
    {}
  );
  return BigInt(st.sync_info.latest_block_height);
}

async function blockTimeMsAtHeight(height: bigint): Promise<number> {
  const block = await rpcCallWithFallback<RpcBlockResponse>(RPC_URLS, "block", {
    height: height.toString(),
  });
  const ms = new Date(block.block.header.time).getTime();
  if (!Number.isFinite(ms)) throw new Error(`Invalid block time at height ${height.toString()}`);
  return ms;
}

async function blockTimeMsAtHeightOrNull(height: bigint): Promise<number | null> {
  try {
    return await blockTimeMsAtHeight(height);
  } catch {
    return null;
  }
}

/**
 * Some RPC providers prune older heights and return errors for low blocks.
 * Find the earliest height still queryable on this RPC.
 */
async function findEarliestQueryableHeight(tip: bigint): Promise<bigint> {
  let lo = BigInt(1);
  let hi = tip;
  while (lo < hi) {
    const mid = (lo + hi) / BigInt(2);
    const ok = (await blockTimeMsAtHeightOrNull(mid)) !== null;
    if (ok) {
      hi = mid;
    } else {
      lo = mid + BigInt(1);
    }
  }
  return lo;
}

/**
 * Find first block height with time >= START_DATE.
 * Uses binary search over block heights to avoid scanning from genesis.
 */
async function findStartHeightByTime(targetMs: number, tip: bigint): Promise<bigint> {
  const earliestQueryable = await findEarliestQueryableHeight(tip);
  const earliestQueryableMs = await blockTimeMsAtHeight(earliestQueryable);
  if (targetMs <= earliestQueryableMs) return earliestQueryable;

  const tipMs = await blockTimeMsAtHeight(tip);
  if (targetMs > tipMs) return tip + BigInt(1);

  let lo = earliestQueryable;
  let hi = tip;
  while (lo < hi) {
    const mid = (lo + hi) / BigInt(2);
    const midMs = await blockTimeMsAtHeight(mid);
    if (midMs < targetMs) {
      lo = mid + BigInt(1);
    } else {
      hi = mid;
    }
  }
  return lo;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function minBigint(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

async function loop(startFloorHeight: bigint) {
  let cursor = await getCursor();
  const tip = await latestHeight();
  const target = tip > BigInt(LAG) ? tip - BigInt(LAG) : BigInt(0);

  let next: bigint;
  if (cursor === BigInt(0)) {
    next = startFloorHeight;
    if (!process.env.INDEXER_START_DATE) {
      const windowStart = target > INITIAL_WINDOW ? target - INITIAL_WINDOW + BigInt(1) : BigInt(1);
      next = windowStart > startFloorHeight ? windowStart : startFloorHeight;
    }
  } else {
    next = cursor + BigInt(1);
  }

  if (next < startFloorHeight) next = startFloorHeight;

  const backlog = target >= next ? target - next + BigInt(1) : BigInt(0);
  const inCatchup = backlog > CATCHUP_THRESHOLD_BLOCKS;
  const batchSize = inCatchup ? CATCHUP_BATCH : BATCH;
  const parallel = inCatchup ? BigInt(CATCHUP_CONCURRENCY) : BigInt(1);

  let processed = 0;
  while (next <= target && processed < batchSize) {
    const remaining = target - next + BigInt(1);
    const room = BigInt(batchSize - processed);
    const chunk = minBigint(minBigint(remaining, parallel), room);
    if (chunk <= BigInt(0)) break;

    const chunkN = Number(chunk);
    const heights: bigint[] = [];
    for (let i = 0; i < chunkN; i++) {
      heights.push(next + BigInt(i));
    }

    const pairs = await Promise.all(heights.map((h) => fetchBlockPair(h)));
    const daily = new Map<string, bigint>();
    const hourly = new Map<string, bigint>();
    const participantTriples = new Set<string>();
    const volumeDeltas = new Map<string, bigint>();
    const feeDeltas = new Map<string, bigint>();
    const offerParticipantTriples = new Set<string>();
    const offerCategoryParticipantTriples = new Set<string>();
    const ymaxAcc = new YmaxAccumulator();
    const provisionAcc = new ProvisionPoolAccumulator();
    for (const p of pairs) {
      accumulateBlock(
        p.block,
        p.results,
        daily,
        hourly,
        participantTriples,
        volumeDeltas,
        feeDeltas,
        offerParticipantTriples,
        offerCategoryParticipantTriples,
        ymaxAcc,
        provisionAcc
      );
    }
    const lastH = heights[heights.length - 1]!;
    // YMax latest-state upserts are idempotent (latest-wins by height), so they go BEFORE the
    // cursor advances: a crash in between re-applies them with the next chunk instead of losing them.
    await persistYmax(db, ymaxAcc);
    await persistProvisionPool(db, provisionAcc);
    await persistIndexedChunk(
      daily,
      hourly,
      participantTriples,
      volumeDeltas,
      feeDeltas,
      offerParticipantTriples,
      offerCategoryParticipantTriples,
      lastH
    );
    cursor = lastH;
    next = lastH + BigInt(1);
    processed += chunkN;
  }

  if (processed > 0) {
    console.log(
      `Indexer: processed ${processed} blocks, cursor=${cursor}, tip=${tip}, mode=${inCatchup ? "catchup" : "tail"}, concurrency=${inCatchup ? CATCHUP_CONCURRENCY : 1}`
    );
  }

  return { processed, inCatchup };
}

/**
 * Keep `denom_price_day` current alongside block indexing: fetch the last PRICE_REFRESH_DAYS days for
 * every configured coin id every PRICE_REFRESH_MS. Runs concurrently with the block loop (never
 * blocks it); a failing run logs and waits for the next tick. Creates the table if absent, so a fresh
 * deploy needs no manual migration — the 365-day history still comes from `npm run backfill:prices`.
 */
async function priceRefreshLoop(): Promise<void> {
  for (;;) {
    try {
      const s = await refreshDailyPrices(db, { days: PRICE_REFRESH_DAYS });
      console.log(
        `[prices] refreshed ${s.idsOk}/${s.idsAttempted} ids, ${s.rowsUpserted} rows` +
          (s.idsFailed.length ? `; failed: ${s.idsFailed.join(", ")}` : "")
      );
    } catch (e) {
      console.warn("[prices] refresh failed; will retry next interval", e);
    }
    await sleep(PRICE_REFRESH_MS);
  }
}

async function main() {
  await ensureOfferCategoryParticipantDayTable(db);
  await ensureYmaxTables(db);
  if (PRICE_REFRESH_DISABLED) console.log("[prices] refresh disabled (PRICE_REFRESH_DISABLED)");
  else void priceRefreshLoop();

  const tip = await latestHeight();
  const startFloorHeight = await findStartHeightByTime(START_DATE_MS, tip);

  console.log(
    `Indexer RPC primary=${RPC_URL_PRIMARY} fallback=${RPC_URL_FALLBACK || "<none>"} startDate=${START_DATE_ISO} startHeight=${startFloorHeight.toString()} tailPoll=${POLL_MS}ms catchupPoll=${CATCHUP_POLL_MS}ms catchupConcurrency=${CATCHUP_CONCURRENCY}`
  );

  for (;;) {
    const { inCatchup } = await loop(startFloorHeight);
    logResolutionWarningsIfDue();
    await sleep(inCatchup ? CATCHUP_POLL_MS : POLL_MS);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
