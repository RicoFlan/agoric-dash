import { Registry } from "@cosmjs/proto-signing";
import { decodeTxRaw } from "@cosmjs/proto-signing";
import type { EncodeObject, GeneratedType } from "@cosmjs/proto-signing";
import { wasmTypes } from "@cosmjs/cosmwasm-stargate";
import { defaultRegistryTypes } from "@cosmjs/stargate";
import {
  MsgWalletAction,
  MsgWalletSpendAction,
} from "@agoric/cosmic-proto/swingset/msgs.js";

/**
 * Agoric-specific (`agoric.swingset.*`) Msg types not present in @cosmjs defaults. Registering them
 * lets {@link decodeMsg} decode smart-wallet actions whose bodies carry marshalled Zoe offers
 * (`spend_action` / `action` CapData). telescope-generated types expose typeUrl + encode/decode/
 * fromPartial, satisfying cosmjs `GeneratedType`. Keep aligned with on-chain protos after upgrades
 * (`protocolCompatibilityNotes.ts`).
 */
export const agoricSwingsetTypes: ReadonlyArray<[string, GeneratedType]> = [
  [MsgWalletSpendAction.typeUrl, MsgWalletSpendAction as unknown as GeneratedType],
  [MsgWalletAction.typeUrl, MsgWalletAction as unknown as GeneratedType],
];

/** Msg decode registry — must stay aligned with on-chain protos after upgrades (`protocolCompatibilityNotes.ts`). */
export const txRegistry = new Registry([
  ...defaultRegistryTypes,
  ...wasmTypes,
  ...agoricSwingsetTypes,
]);

export interface EventKV {
  readonly type: string;
  readonly attributes: ReadonlyArray<{ readonly key: string; readonly value: string }>;
}

/** Parse coins string like "12773ubld" or "10ubld,5uist" */
export function parseCoinsAmounts(amountStr: string): Map<string, bigint> {
  const out = new Map<string, bigint>();
  if (!amountStr) return out;
  for (const part of amountStr.split(",")) {
    const m = part.trim().match(/^(\d+)([a-zA-Z0-9\/\.-]+)$/);
    if (!m) continue;
    const amt = BigInt(m[1]);
    const denom = m[2];
    out.set(denom, (out.get(denom) ?? BigInt(0)) + amt);
  }
  return out;
}

/**
 * Paid fees: `tx` event attribute `fee` after execution (Cosmos SDK indexing).
 * Prefer over signed max fee in TxRaw — see `SERIES_ROLLUP_SOURCE` in rollupSourceHierarchy.ts.
 */
export function extractPaidFeesFromEvents(events: readonly EventKV[]): Map<string, bigint> {
  const merged = new Map<string, bigint>();
  for (const ev of events) {
    if (ev.type !== "tx") continue;
    let feeStr = "";
    for (const a of ev.attributes) {
      if (a.key === "fee") feeStr = a.value;
    }
    if (!feeStr) continue;
    for (const [d, v] of parseCoinsAmounts(feeStr)) {
      merged.set(d, (merged.get(d) ?? BigInt(0)) + v);
    }
  }
  return merged;
}

export function decodeTxRawTx(txBytes: Uint8Array) {
  return decodeTxRaw(txBytes);
}

export function decodeMsg(msg: EncodeObject) {
  return txRegistry.decode(msg);
}

export function classifyModuleFamily(typeUrl: string): string {
  if (typeUrl.includes("cosmos.bank")) return "bank";
  if (typeUrl.includes("cosmos.staking")) return "staking";
  if (typeUrl.includes("cosmos.distribution")) return "distribution";
  if (typeUrl.includes("cosmos.gov")) return "gov";
  if (typeUrl.includes("ibc.applications.transfer")) return "ibc-transfer";
  if (typeUrl.includes("ibc.core")) return "ibc-core";
  if (typeUrl.includes("wasm")) return "wasm";
  if (typeUrl.includes("agoric")) return "agoric";
  return "other";
}

/**
 * Fee payer recorded on the `tx` event that carries the fee, when present.
 *
 * The ante handler emits `fee` and `fee_payer` together, so this works for FAILED transactions too,
 * where the message body may not decode but the fee was still committed. Prefer it over decoding
 * AuthInfo when attributing a fee that the chain actually took.
 */
export function extractFeePayerFromEvents(events: readonly EventKV[]): string | null {
  for (const ev of events) {
    if (ev.type !== "tx") continue;
    let hasFee = false;
    let payer: string | null = null;
    for (const a of ev.attributes) {
      if (a.key === "fee") hasFee = true;
      if (a.key === "fee_payer" && a.value) payer = a.value;
    }
    if (hasFee && payer) return payer;
  }
  return null;
}
