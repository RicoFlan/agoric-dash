/**
 * Pure decoding + summarization of smart-wallet OFFER OUTCOMES from block vstorage events.
 *
 * Unlike offer *intent* (Phase 1, decoded from the submitting tx's MsgWallet(Spend)Action), an
 * offer's *outcome* is asynchronous: the smart wallet publishes it to vstorage `published.wallet.
 * <addr>` after Zoe settles. Those vstorage writes surface in CometBFT `block_results.
 * finalize_block_events` as `state_change` events (store=vstorage), so we can self-index outcomes
 * with no external indexer — see docs and the Phase 2 investigation.
 *
 * This module is PURE (no @endo, no I/O): event/StreamCell parsing is plain JSON; the per-update
 * CapData decode (which needs @endo/marshal) is done by the caller via `parseCapData`, and the
 * decoded plain object is handed to {@link summarizeOfferStatus}.
 *
 * Counting rule (avoids over-counting the several status publications per offer): an offer is
 * counted exactly ONCE, at its terminal settle — the cumulative `offerStatus` update that carries
 * `payouts` (emitted when payouts are deposited). Earlier publications (result-only,
 * numWantsSatisfied-only) are intermediate and skipped. The terminal update is cumulative, so an
 * errored offer's final record carries both `error` and the refund `payouts`; we classify it
 * `errored` from that single update rather than counting an extra time.
 */
import { BoardSlot, type OfferLeg } from "@/lib/walletOfferTypes";

export interface VstorageEventAttr {
  readonly key: string;
  readonly value: string;
}
export interface VstorageEvent {
  readonly type: string;
  readonly attributes?: readonly VstorageEventAttr[];
}

/** A wallet's StreamCell from one block: the owner address + the raw CapData update strings. */
export interface WalletStreamCell {
  readonly address: string;
  readonly capDataStrings: string[];
}

export type OfferOutcome = "wants_satisfied" | "wants_unsatisfied" | "errored";

export interface OfferOutcomeFact {
  /** Client-chosen offer id (opaque); kept for debugging/dedup, not required for counting. */
  readonly offerId: string | null;
  readonly outcome: OfferOutcome;
  /** Payout legs deposited at settle: keyword → brand board id + atomic value (for USD valuation). */
  readonly payouts: readonly OfferLeg[];
}

/**
 * Decode a vstorage event `key` into its dotted path segments. The raw key is NUL-separated and may
 * carry a leading numeric store-sequence token before "published" (e.g. "3\0published\0wallet\0…").
 */
export function decodeVstoragePath(rawKey: string): string[] {
  const parts = rawKey.split("\u0000").filter((s) => s.length > 0);
  const pubIdx = parts.indexOf("published");
  return pubIdx >= 0 ? parts.slice(pubIdx) : parts;
}

/**
 * Extract `published.wallet.<addr>` StreamCells from a block's finalize events. Pure JSON parsing
 * only; the per-update CapData strings are returned verbatim for the caller to decode with @endo.
 */
export function extractWalletStreamCells(
  events: readonly VstorageEvent[] | undefined
): WalletStreamCell[] {
  if (!events) return [];
  const out: WalletStreamCell[] = [];
  for (const e of events) {
    if (e.type !== "state_change") continue;
    const attrs = new Map<string, string>();
    for (const a of e.attributes ?? []) attrs.set(a.key, a.value);
    if (attrs.get("store") !== "vstorage") continue;
    const rawKey = attrs.get("key");
    const value = attrs.get("value");
    if (!rawKey || !value) continue;
    const path = decodeVstoragePath(rawKey);
    // Exactly the per-wallet update stream node `published.wallet.<addr>` (length 3). Deeper paths
    // like `…<addr>.current` are full snapshot records (no `updated` field) — skip to avoid decoding
    // large records that carry no offer outcome.
    if (path.length !== 3 || path[0] !== "published" || path[1] !== "wallet") continue;
    let cell: { values?: unknown };
    try {
      cell = JSON.parse(value) as { values?: unknown };
    } catch {
      continue;
    }
    const values = Array.isArray(cell.values)
      ? cell.values.filter((v): v is string => typeof v === "string")
      : [];
    if (values.length === 0) continue;
    out.push({ address: path[2]!, capDataStrings: values });
  }
  return out;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Extract `{ keyword: { brand, value } }` amount legs into OfferLeg[] (brand board id + value). */
function legsFrom(amountKeywordRecord: unknown): OfferLeg[] {
  const rec = asRecord(amountKeywordRecord);
  if (!rec) return [];
  const out: OfferLeg[] = [];
  for (const [keyword, amt] of Object.entries(rec)) {
    const a = asRecord(amt);
    if (!a) continue;
    const brand = a.brand;
    out.push({
      keyword,
      brandBoardId: brand instanceof BoardSlot ? brand.boardId : null,
      value: a.value !== undefined && a.value !== null ? String(a.value) : null,
    });
  }
  return out;
}

/**
 * Summarize one decoded wallet update (from `parseCapData`) into a terminal offer outcome, or null
 * if it is not a settled Zoe offer status. See the module-level counting rule.
 */
export function summarizeOfferStatus(decodedUpdate: unknown): OfferOutcomeFact | null {
  const rec = asRecord(decodedUpdate);
  if (!rec || rec.updated !== "offerStatus") return null;
  const status = asRecord(rec.status);
  if (!status) return null;

  // Terminal only once payouts are deposited (presence of the property; value may be `{}`).
  const hasPayouts =
    Object.prototype.hasOwnProperty.call(status, "payouts") && status.payouts !== undefined;
  if (!hasPayouts) return null;

  const offerId = typeof status.id === "string" ? status.id : null;
  const payouts = legsFrom(status.payouts);
  const error = typeof status.error === "string" && status.error.length > 0;
  if (error) return { offerId, outcome: "errored", payouts };

  const nws = status.numWantsSatisfied;
  if (typeof nws === "number" && nws === 0) return { offerId, outcome: "wants_unsatisfied", payouts };
  return { offerId, outcome: "wants_satisfied", payouts };
}
