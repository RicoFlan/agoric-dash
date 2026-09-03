/**
 * Pure decoding of YMax's published state (`published.ymax0.*`) from vstorage cells.
 *
 * YMax (Agoric's yield product) publishes, per portfolio:
 *   published.ymax0.portfolios.<p>                — status: accounts by chain, target allocation,
 *                                                  running flows (with type + amount), position keys
 *   published.ymax0.portfolios.<p>.positions.<k>  — cumulative totalIn / totalOut / netTransfers per
 *                                                  venue (key = `<protocol>_<chain>`)
 *   published.ymax0.portfolios.<p>.flows.<f>      — flow progress: { how, state, step }
 *
 * Positions are cumulative, so the latest record per (portfolio, key) is the truth and
 * Σ (totalIn − totalOut) is principal currently deployed — not marked to yield. Flow amounts live on
 * the portfolio status (`flowsRunning`), not on the flow node, so flows are recorded from status
 * updates and deduped by (portfolio, flowId).
 *
 * This module is PURE: it takes the plain object produced by `parseCapData` (BoardSlot markers,
 * string bigints) and returns typed summaries; shapes vary by contract version, so every field is
 * optional-tolerant. Fixtures in ymaxVstorage.test.ts are captured from mainnet.
 */
import { BoardSlot } from "@/lib/walletOfferTypes";
import type { VstorageEvent } from "@/lib/walletOutcomeSummary";
import { decodeVstoragePath } from "@/lib/walletOutcomeSummary";

export const YMAX_ROOTS = ["ymax0", "ymax1"] as const;

export type YmaxPath =
  | { kind: "portfolio"; contract: string; portfolio: string }
  | { kind: "position"; contract: string; portfolio: string; key: string }
  | { kind: "flow"; contract: string; portfolio: string; flowId: string }
  | { kind: "other"; contract: string; path: string[] };

/** Classify a decoded vstorage path under a YMax root, or null if it is not YMax. */
export function classifyYmaxPath(path: readonly string[]): YmaxPath | null {
  if (path[0] !== "published" || !path[1] || !(YMAX_ROOTS as readonly string[]).includes(path[1])) return null;
  const contract = path[1];
  if (path[2] === "portfolios" && path[3]) {
    const portfolio = path[3];
    if (path.length === 4) return { kind: "portfolio", contract, portfolio };
    if (path[4] === "positions" && path[5] && path.length === 6) return { kind: "position", contract, portfolio, key: path[5] };
    if (path[4] === "flows" && path[5] && path.length === 6) return { kind: "flow", contract, portfolio, flowId: path[5] };
  }
  return { kind: "other", contract, path: [...path] };
}

/** A vstorage StreamCell under a YMax root: the path plus its raw CapData update strings. */
export interface YmaxStreamCell {
  readonly path: YmaxPath;
  readonly capDataStrings: string[];
}

/** Extract YMax cells from a block's finalize events (same event shape as wallet cells). */
export function extractYmaxStreamCells(events: readonly VstorageEvent[] | undefined): YmaxStreamCell[] {
  if (!events) return [];
  const out: YmaxStreamCell[] = [];
  for (const e of events) {
    if (e.type !== "state_change") continue;
    const attrs = new Map<string, string>();
    for (const a of e.attributes ?? []) attrs.set(a.key, a.value);
    if (attrs.get("store") !== "vstorage") continue;
    const rawKey = attrs.get("key");
    const value = attrs.get("value");
    if (!rawKey || !value) continue;
    const path = classifyYmaxPath(decodeVstoragePath(rawKey));
    if (!path || path.kind === "other") continue;
    let cell: { values?: unknown };
    try {
      cell = JSON.parse(value) as { values?: unknown };
    } catch {
      continue;
    }
    const values = Array.isArray(cell.values) ? cell.values.filter((v): v is string => typeof v === "string") : [];
    if (values.length === 0) continue;
    out.push({ path, capDataStrings: values });
  }
  return out;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
/** Amount `{ brand, value }` → board id + non-negative integer string (Nat as "+123" or "123"). */
function amountOf(v: unknown): { brandBoardId: string | null; value: string } | null {
  const a = asRecord(v);
  if (!a) return null;
  const raw = a.value;
  const s = typeof raw === "string" ? raw.replace(/^\+/, "") : typeof raw === "number" || typeof raw === "bigint" ? String(raw) : null;
  if (s === null || !/^\d+$/.test(s)) return null;
  return { brandBoardId: a.brand instanceof BoardSlot ? a.brand.boardId : null, value: s };
}

/** CAIP-2 chain id → human chain label used by YMax position keys. Unknown ids fall back to the raw id. */
export const CAIP_CHAIN_LABELS: Record<string, string> = {
  "eip155:1": "Ethereum",
  "eip155:10": "Optimism",
  "eip155:8453": "Base",
  "eip155:42161": "Arbitrum",
  "eip155:43114": "Avalanche",
  "eip155:137": "Polygon",
  "cosmos:agoric-3": "agoric",
  "cosmos:noble-1": "noble",
};

/** "eip155:43114:0xabc…" → { chainId: "eip155:43114", address: "0xabc…" }. */
export function splitCaipAccount(accountId: string | null): { chainId: string | null; address: string | null } {
  if (!accountId) return { chainId: null, address: null };
  const parts = accountId.split(":");
  if (parts.length < 3) return { chainId: null, address: accountId };
  return { chainId: `${parts[0]}:${parts[1]}`, address: parts.slice(2).join(":") };
}

export interface YmaxPortfolioSummary {
  /** Agoric deposit address (users send USDC here). */
  depositAddress: string | null;
  /** The portfolio's Agoric account (LocalChainAccount) — sender of orchestration IBC transfers. */
  agoricAccount: string | null;
  /** chain label → CAIP account id, e.g. { Avalanche: "eip155:43114:0x…" }. */
  accountIdByChain: Record<string, string>;
  positionKeys: string[];
  policyVersion: number | null;
  flowCount: number | null;
  rebalanceCount: number | null;
  /** Flows in progress at this update; amount present for deposit/withdraw. */
  flowsRunning: { flowId: string; type: string; amount: { brandBoardId: string | null; value: string } | null }[];
}

export function summarizePortfolio(decoded: unknown): YmaxPortfolioSummary | null {
  const rec = asRecord(decoded);
  if (!rec) return null;
  const byChain: Record<string, string> = {};
  const acc = asRecord(rec.accountIdByChain);
  if (acc) for (const [chain, id] of Object.entries(acc)) if (typeof id === "string") byChain[chain] = id;
  // Newer versions publish accountStateByChain { chain: { address, chainId, state } } as well.
  const st = asRecord(rec.accountStateByChain);
  if (st) {
    for (const [chain, v] of Object.entries(st)) {
      const r = asRecord(v);
      if (r && typeof r.address === "string" && typeof r.chainId === "string" && !byChain[chain]) byChain[chain] = `${r.chainId}:${r.address}`;
    }
  }
  const agoricAccount = splitCaipAccount(byChain.agoric ?? null).address;
  const flows: YmaxPortfolioSummary["flowsRunning"] = [];
  const fr = asRecord(rec.flowsRunning);
  if (fr) {
    for (const [flowId, v] of Object.entries(fr)) {
      const r = asRecord(v);
      if (!r) continue;
      flows.push({ flowId, type: asString(r.type) ?? "unknown", amount: amountOf(r.amount) });
    }
  }
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\+?\d+$/.test(v) ? Number(v.replace(/^\+/, "")) : null);
  return {
    depositAddress: asString(rec.depositAddress),
    agoricAccount,
    accountIdByChain: byChain,
    positionKeys: Array.isArray(rec.positionKeys) ? rec.positionKeys.filter((k): k is string => typeof k === "string") : [],
    policyVersion: num(rec.policyVersion),
    flowCount: num(rec.flowCount),
    rebalanceCount: num(rec.rebalanceCount),
    flowsRunning: flows,
  };
}

export interface YmaxPositionSummary {
  protocol: string | null;
  /** Chain label: the suffix of the position key (`Aave_Avalanche` → `Avalanche`), else from the CAIP id. */
  chain: string | null;
  accountId: string | null;
  brandBoardId: string | null;
  totalIn: string;
  totalOut: string;
  netTransfers: string;
}

export function summarizePosition(decoded: unknown, positionKey: string): YmaxPositionSummary | null {
  const rec = asRecord(decoded);
  if (!rec) return null;
  const tin = amountOf(rec.totalIn);
  const tout = amountOf(rec.totalOut);
  const net = amountOf(rec.netTransfers);
  if (!tin && !tout) return null;
  const accountId = asString(rec.accountId);
  const { chainId } = splitCaipAccount(accountId);
  const keyChain = positionKey.includes("_") ? positionKey.slice(positionKey.lastIndexOf("_") + 1) : null;
  return {
    protocol: asString(rec.protocol) ?? (positionKey.includes("_") ? positionKey.slice(0, positionKey.lastIndexOf("_")) : null),
    chain: keyChain ?? (chainId ? CAIP_CHAIN_LABELS[chainId] ?? chainId : null),
    accountId,
    brandBoardId: tin?.brandBoardId ?? tout?.brandBoardId ?? net?.brandBoardId ?? null,
    totalIn: tin?.value ?? "0",
    totalOut: tout?.value ?? "0",
    netTransfers: net?.value ?? "0",
  };
}

export interface YmaxFlowSummary {
  how: string | null;
  state: string | null;
  step: number | null;
}

export function summarizeFlow(decoded: unknown): YmaxFlowSummary | null {
  const rec = asRecord(decoded);
  if (!rec) return null;
  return {
    how: asString(rec.how),
    state: asString(rec.state),
    step: typeof rec.step === "number" ? rec.step : null,
  };
}

/** Flow states that end a flow (everything else is in progress). */
export const YMAX_TERMINAL_FLOW_STATES = new Set(["done", "fail", "failed", "error", "cancelled"]);
