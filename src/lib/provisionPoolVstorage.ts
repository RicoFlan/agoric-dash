/**
 * Pure decoding of `published.provisionPool.metrics` — the provision pool's own running totals.
 *
 * The pool provisions smart wallets and publishes CUMULATIVE counters:
 *   walletsProvisioned   — wallets provisioned since genesis
 *   totalMintedProvided  — BLD the pool has minted to fund those provisionings
 *   totalMintedConverted — BLD minted then converted back (observed 0 on agoric-3)
 *
 * Why this is worth indexing: differenced per day it gives NEW WALLETS, which is the one Q4 signal
 * a single actor cannot inflate. Distinct-address counts can be manufactured by one party opening
 * addresses; a provisioned smart wallet costs a real fee, so the count is bounded by spend.
 *
 * **The counters are cumulative, which dictates how they are stored.** Every other rollup in this
 * codebase is additive (`value + excluded.value`) and therefore double-counts on replay. A
 * cumulative source must NOT be stored that way: the right shape is the last observed snapshot per
 * day, upserted by day, so replaying a height is idempotent by construction rather than by
 * discipline. Daily deltas are then a read-time difference of consecutive snapshots.
 *
 * This module is PURE: it takes the plain object from `parseCapData` (BoardSlot markers, string
 * bigints) and returns a typed snapshot. Shapes vary by contract version, so every field is
 * optional-tolerant — a metrics publication missing `walletsProvisioned` yields null rather than 0,
 * because 0 provisioned wallets and "this publication did not say" are different facts.
 */
import { BoardSlot } from "@/lib/walletOfferTypes";
import type { VstorageEvent } from "@/lib/walletOutcomeSummary";
import { decodeVstoragePath } from "@/lib/walletOutcomeSummary";

/** The single vstorage path this module reads. */
export const PROVISION_POOL_METRICS_PATH = ["published", "provisionPool", "metrics"] as const;

export interface ProvisionPoolSnapshot {
  /** Cumulative wallets provisioned since genesis; null when the publication omitted it. */
  readonly walletsProvisioned: number | null;
  /** Cumulative minted-and-provided, atomic integer string (ubld); null when omitted. */
  readonly totalMintedProvided: string | null;
  /** Cumulative minted-then-converted; observed 0 on agoric-3, kept so a change is visible. */
  readonly totalMintedConverted: string | null;
  /** Board id of the brand the minted amounts are denominated in (BLD on agoric-3). */
  readonly brandBoardId: string | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Amount `{ brand, value }` → board id + non-negative integer string (Nat as "+123" or "123"). */
function amountOf(v: unknown): { brandBoardId: string | null; value: string } | null {
  const a = asRecord(v);
  if (!a) return null;
  const raw = a.value;
  const s =
    typeof raw === "string" ? raw.replace(/^\+/, "") : typeof raw === "number" || typeof raw === "bigint" ? String(raw) : null;
  if (s === null || !/^\d+$/.test(s)) return null;
  return { brandBoardId: a.brand instanceof BoardSlot ? a.brand.boardId : null, value: s };
}

/** A Nat published bare rather than as an Amount, e.g. `walletsProvisioned: "+1453"`. */
function natOf(v: unknown): number | null {
  const s = typeof v === "string" ? v.replace(/^\+/, "") : typeof v === "number" ? String(v) : null;
  if (s === null || !/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/** Decode one metrics publication. Returns null when nothing usable was present. */
export function summarizeProvisionPoolMetrics(decoded: unknown): ProvisionPoolSnapshot | null {
  const rec = asRecord(decoded);
  if (!rec) return null;
  const provided = amountOf(rec.totalMintedProvided);
  const converted = amountOf(rec.totalMintedConverted);
  const wallets = natOf(rec.walletsProvisioned);
  if (wallets === null && !provided) return null;
  return {
    walletsProvisioned: wallets,
    totalMintedProvided: provided?.value ?? null,
    totalMintedConverted: converted?.value ?? null,
    brandBoardId: provided?.brandBoardId ?? converted?.brandBoardId ?? null,
  };
}

/** True when a decoded vstorage path is exactly `published.provisionPool.metrics`. */
export function isProvisionPoolMetricsPath(path: readonly string[]): boolean {
  return (
    path.length === PROVISION_POOL_METRICS_PATH.length &&
    PROVISION_POOL_METRICS_PATH.every((seg, i) => path[i] === seg)
  );
}

/**
 * Raw CapData strings published to the metrics path in one block's finalize events.
 *
 * A StreamCell can carry several values for one path in a single block; the LAST is the state as of
 * that block, which is what a cumulative counter means.
 */
export function extractProvisionPoolCapData(events: readonly VstorageEvent[] | undefined): string[] {
  if (!events) return [];
  const out: string[] = [];
  for (const e of events) {
    if (e.type !== "state_change") continue;
    const attrs = new Map<string, string>();
    for (const a of e.attributes ?? []) attrs.set(a.key, a.value);
    if (attrs.get("store") !== "vstorage") continue;
    const rawKey = attrs.get("key");
    const value = attrs.get("value");
    if (!rawKey || !value) continue;
    if (!isProvisionPoolMetricsPath(decodeVstoragePath(rawKey))) continue;
    let cell: { values?: unknown };
    try {
      cell = JSON.parse(value) as { values?: unknown };
    } catch {
      continue;
    }
    const values = Array.isArray(cell.values) ? cell.values.filter((v): v is string => typeof v === "string") : [];
    if (values.length > 0) out.push(values[values.length - 1]!);
  }
  return out;
}
