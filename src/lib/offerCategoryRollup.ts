/**
 * Per-block accumulation of the two P2 outputs, shared by the backfill and the parity check (the
 * indexer computes the same things inline in its main tx loop, from the same helpers):
 *
 *  - `offer_category_participant_day` triples (day × owner × category) from MsgWallet(Spend)Action
 *    in SUCCESSFUL txs — `decodeWalletAction` (walletActionDecode.ts).
 *  - `offer_outcome_category` daily/hourly deltas (`<category>|<outcome>`) from terminal offerStatus
 *    updates in `finalize_block_events` — `summarizeOfferStatus` + the echoed invitationSpec.
 *
 * Keys use the indexer's `\0`-joined convention so the flush code is interchangeable.
 */
import type { EncodeObject } from "@cosmjs/proto-signing";
import { fromBase64 } from "@cosmjs/encoding";
import { instanceName } from "@/lib/agoricInstanceNames";
import { pairedTxCount } from "@/lib/blockTxResultsPairing";
import { decodeTxRawTx } from "@/lib/cosmos";
import { outcomeCategoryDim, OUTCOME_CATEGORY_UNCLASSIFIED } from "@/lib/offerOutcomeCategory";
import type { RpcBlockResponse, RpcBlockResultsResponse } from "@/lib/rpc";
import { SERIES, TX_SUCCESS_CODE, WALLET_ACTION_MSG_TYPES } from "@/lib/semantics";
import { decodeWalletAction, offerCategoryOf } from "@/lib/walletActionDecode";
import { parseCapData } from "@/lib/walletOfferMarshal";
import { extractWalletStreamCells, summarizeOfferStatus } from "@/lib/walletOutcomeSummary";

export const ROLLUP_KEY_DELIM = "\0";

function dayUtc(isoTime: string): string {
  return new Date(isoTime).toISOString().slice(0, 10);
}

function hourStartIso(isoTime: string): string {
  const d = new Date(isoTime);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

function bump(m: Map<string, bigint>, key: string, delta: bigint) {
  m.set(key, (m.get(key) ?? BigInt(0)) + delta);
}

/**
 * Accumulate one block. `daily` / `hourly` receive `offer_outcome_category` deltas only;
 * `categoryTriples` receives `day\0owner\0category` strings. Never throws on a bad tx / update.
 */
export function accumulateOfferCategoriesFromBlock(
  block: RpcBlockResponse,
  results: RpcBlockResultsResponse,
  daily: Map<string, bigint>,
  hourly: Map<string, bigint>,
  categoryTriples: Set<string>
): void {
  const iso = block.block.header.time;
  const day = dayUtc(iso);
  const hourIso = hourStartIso(iso);

  // Outcomes by category (block-grain vstorage; independent of tx success).
  const events = results.finalize_block_events ?? results.end_block_events;
  for (const cell of extractWalletStreamCells(events)) {
    for (const capDataString of cell.capDataStrings) {
      let fact;
      try {
        fact = summarizeOfferStatus(parseCapData(capDataString));
      } catch {
        continue;
      }
      if (!fact) continue;
      const category = fact.spec ? offerCategoryOf(fact.spec, instanceName(fact.spec.instanceBoardId)) : OUTCOME_CATEGORY_UNCLASSIFIED;
      const dim = outcomeCategoryDim(category, fact.outcome);
      bump(daily, [day, SERIES.OFFER_OUTCOME_CATEGORY, dim].join(ROLLUP_KEY_DELIM), BigInt(1));
      bump(hourly, [hourIso, SERIES.OFFER_OUTCOME_CATEGORY, dim].join(ROLLUP_KEY_DELIM), BigInt(1));
    }
  }

  // Category participants (successful txs only, like offer_participant_day).
  const txsB64 = block.block.data?.txs ?? [];
  const txResults = results.txs_results ?? [];
  const n = pairedTxCount(txsB64.length, txResults.length);
  for (let i = 0; i < n; i++) {
    if (txResults[i]!.code !== TX_SUCCESS_CODE) continue;
    let decoded;
    try {
      decoded = decodeTxRawTx(fromBase64(txsB64[i]!));
    } catch {
      continue;
    }
    for (const msg of decoded.body.messages) {
      const enc = msg as EncodeObject;
      if (!WALLET_ACTION_MSG_TYPES.has(enc.typeUrl)) continue;
      const w = decodeWalletAction(enc);
      if (w?.owner) categoryTriples.add([day, w.owner, w.category].join(ROLLUP_KEY_DELIM));
    }
  }
}
