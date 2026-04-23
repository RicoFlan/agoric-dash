import { Registry } from "@cosmjs/proto-signing";
import { decodeTxRaw } from "@cosmjs/proto-signing";
import type { EncodeObject } from "@cosmjs/proto-signing";
import { wasmTypes } from "@cosmjs/cosmwasm-stargate";
import { defaultRegistryTypes } from "@cosmjs/stargate";

export const txRegistry = new Registry([...defaultRegistryTypes, ...wasmTypes]);

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
 * Paid fees: prefer `tx` event attribute `fee` (Cosmos SDK / CometBFT indexing).
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
