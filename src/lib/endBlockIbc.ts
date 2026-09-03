/**
 * Outbound ICS-20 transfers executed in EndBlock — i.e. by orchestration (SwingSet's vlocalchain
 * executing `MsgTransfer` for a contract's LocalChainAccount), never by a user transaction. They
 * surface only in `block_results.finalize_block_events` as `send_packet` events with the ICS-20
 * packet JSON hex-encoded in `packet_data_hex`; the tx-scoped `ibc_transfer_amount_out` cannot see
 * them. Found while diagnosing YMax: ~$6.8M of USDC entered Agoric over IBC in H1 2026, on-chain
 * supply is ~$25k, and the tx-scoped outflow totals ~$1.2M — the rest left this way.
 *
 * Denom normalisation: the packet's `denom` is the ICS-20 trace ("transfer/channel-62/uusdc" for a
 * voucher being returned, "ubld" for a native asset); vouchers are mapped back to the on-chain
 * `ibc/<SHA256>` id so the series shares dimensions with every other per-denom series.
 */
import { createHash } from "node:crypto";
import type { VstorageEvent } from "@/lib/walletOutcomeSummary";

export interface EndBlockIbcSend {
  /** On-chain denom (`ibc/HASH` or native). */
  denom: string;
  amount: bigint;
  sender: string | null;
  receiver: string | null;
  srcChannel: string | null;
}

/** ICS-20 trace path → on-chain voucher denom (`ibc/` + uppercase SHA-256 of the full trace). */
export function ibcDenomFromTrace(trace: string): string {
  if (!trace.includes("/")) return trace;
  return "ibc/" + createHash("sha256").update(trace).digest("hex").toUpperCase();
}

function hexToUtf8(hex: string): string | null {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) return null;
  try {
    return Buffer.from(hex, "hex").toString("utf8");
  } catch {
    return null;
  }
}

/** Parse one `send_packet` event (any scope) into a transfer, or null when it is not a valid ICS-20 send. */
export function parseSendPacketEvent(e: VstorageEvent): EndBlockIbcSend | null {
  if (e.type !== "send_packet") return null;
  const attrs = new Map<string, string>();
  for (const a of e.attributes ?? []) attrs.set(a.key, a.value);
  if (attrs.get("packet_src_port") !== "transfer") return null;
  let json = attrs.get("packet_data") ?? null;
  if (!json) {
    const hex = attrs.get("packet_data_hex");
    json = hex ? hexToUtf8(hex) : null;
  }
  if (!json) return null;
  let data: { denom?: unknown; amount?: unknown; sender?: unknown; receiver?: unknown };
  try {
    data = JSON.parse(json) as typeof data;
  } catch {
    return null;
  }
  if (typeof data.denom !== "string" || typeof data.amount !== "string" || !/^\d+$/.test(data.amount)) return null;
  return {
    denom: ibcDenomFromTrace(data.denom),
    amount: BigInt(data.amount),
    sender: typeof data.sender === "string" ? data.sender : null,
    receiver: typeof data.receiver === "string" ? data.receiver : null,
    srcChannel: attrs.get("packet_src_channel") ?? null,
  };
}

/**
 * ICS-20 sends in a block's finalize events. When events carry a `mode` attribute (CometBFT ≥ 0.38
 * with the Cosmos SDK's block-stage tagging) only `EndBlock`/`BeginBlock` ones are kept, so a node
 * that folds tx events into finalize events cannot double-count against the tx-scoped series.
 */
export function endBlockIbcSends(events: readonly VstorageEvent[] | undefined): EndBlockIbcSend[] {
  if (!events) return [];
  const out: EndBlockIbcSend[] = [];
  for (const e of events) {
    if (e.type !== "send_packet") continue;
    const mode = e.attributes?.find((a) => a.key === "mode")?.value;
    if (mode && mode !== "EndBlock" && mode !== "BeginBlock") continue;
    const s = parseSendPacketEvent(e);
    if (s && s.amount > BigInt(0)) out.push(s);
  }
  return out;
}
