/**
 * Indexer-only: unmarshal a smart-wallet action string (`MsgWalletSpendAction.spend_action` /
 * `MsgWalletAction.action`) into a PLAIN structure consumable by the pure {@link summarizeWalletAction}.
 *
 * The action string is JSON CapData `{ body, slots }` (smallcaps body). We decode it with
 * @endo/marshal, resolving each slot to a tracked {@link BoardSlot} remotable, then deep-replace
 * remotables with `BoardSlot` markers and bigints with decimal strings, yielding JSON-able data.
 *
 * SES: the two shim imports below install the eventual-send + assert shims WITHOUT calling
 * `lockdown()` (Object.prototype stays unfrozen). Validated in Phase 0b that this is sufficient for
 * `fromCapData` (including `Far`-based slot resolution) and coexists with cosmjs/pg/drizzle. The
 * shims MUST be imported before @endo/marshal, and pre.js (assert) before eventual-send/shim.
 *
 * This module must NOT be imported by the read/UI path — only the indexer and diagnostic scripts.
 */
import "@endo/init/pre.js";
import "@endo/eventual-send/shim.js";
import { Far, makeMarshal } from "@endo/marshal";
import { BoardSlot } from "@/lib/walletOfferTypes";

/** Maps each decoded remotable back to its Board id + iface so we can substitute after fromCapData. */
const slotMeta = new WeakMap<object, { boardId: string; iface: string | null }>();

function ifaceTail(iface: string | undefined): string | null {
  if (!iface) return null;
  // e.g. "Alleged: InstanceHandle" → "InstanceHandle".
  return iface.replace(/^Alleged:\s*/, "");
}

const marshaller = makeMarshal(
  undefined,
  (slot: string, iface?: string): object => {
    const remotable = Far(`BoardRemote${iface ? ` ${iface}` : ""}`, {}) as object;
    slotMeta.set(remotable, { boardId: slot, iface: ifaceTail(iface) });
    return remotable;
  },
  { serializeBodyFormat: "smallcaps" }
);

/** Deep-replace remotables → BoardSlot markers and bigints → decimal strings. */
function plainify(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (typeof v !== "object" || v === null) return v;
  if (slotMeta.has(v)) {
    const { boardId, iface } = slotMeta.get(v)!;
    return new BoardSlot(boardId, iface);
  }
  if (Array.isArray(v)) return v.map(plainify);
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = plainify(val);
  }
  return out;
}

/**
 * Decode a CapData string `{ body, slots }` to a plain JS structure (BoardSlot markers for remotables
 * + decimal-string bigints). Returns null on any malformed/undecodable input — callers treat that as
 * "skip", never throws. Used for smart-wallet actions and for agoricNames vstorage values.
 */
export function parseCapData(capDataString: string): unknown | null {
  if (!capDataString) return null;
  let capData: unknown;
  try {
    capData = JSON.parse(capDataString);
  } catch {
    return null;
  }
  try {
    const decoded = marshaller.fromCapData(capData as { body: string; slots: string[] });
    return plainify(decoded);
  } catch {
    return null;
  }
}

/** Alias for the smart-wallet action body (`spend_action` / `action`). */
export const parseWalletActionString = parseCapData;
