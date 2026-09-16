/**
 * The dashboard's shareable view state: range and granularity, carried in the query string.
 *
 * Pure so it can be tested without a browser. Parsing is deliberately strict and total: any query
 * string at all produces a usable result, because a link pasted from chat may be truncated, stale,
 * or hand-edited, and a malformed parameter must fall back to the default view rather than render a
 * range the user never asked for. An out-of-order pair is swapped rather than rejected, since that
 * is unambiguous and almost certainly a typo.
 */
import type { Granularity } from "@/components/dashboard/types";

export const GRANULARITIES: readonly Granularity[] = ["hour", "day", "week"];

export interface DashboardViewState {
  from: string;
  to: string;
  granularity: Granularity;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day in YYYY-MM-DD, rejecting shapes like 2026-02-31 that Date would roll over. */
export function isCalendarDay(v: unknown): v is string {
  if (typeof v !== "string" || !DAY_RE.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

export function isGranularity(v: unknown): v is Granularity {
  return typeof v === "string" && (GRANULARITIES as readonly string[]).includes(v);
}

/**
 * Read view state from a query string, falling back per field. `floorDay` clamps `from` to the start
 * of indexed history so a shared link cannot request a window the database can never fill.
 */
export function parseViewState(
  search: string,
  defaults: DashboardViewState,
  floorDay?: string
): DashboardViewState {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  } catch {
    return defaults;
  }
  const rawFrom = params.get("from");
  const rawTo = params.get("to");
  const rawG = params.get("g") ?? params.get("granularity");

  let from = isCalendarDay(rawFrom) ? rawFrom : defaults.from;
  let to = isCalendarDay(rawTo) ? rawTo : defaults.to;
  if (from > to) [from, to] = [to, from];
  if (floorDay && from < floorDay) from = floorDay;
  if (floorDay && to < floorDay) to = floorDay;

  return { from, to, granularity: isGranularity(rawG) ? rawG : defaults.granularity };
}

/**
 * Serialize view state to a query string, omitting whatever matches the default so the common view
 * keeps a clean URL. Returns "" when nothing differs from the default.
 */
export function serializeViewState(state: DashboardViewState, defaults: DashboardViewState): string {
  const params = new URLSearchParams();
  if (state.from !== defaults.from) params.set("from", state.from);
  if (state.to !== defaults.to) params.set("to", state.to);
  if (state.granularity !== defaults.granularity) params.set("g", state.granularity);
  const q = params.toString();
  return q ? `?${q}` : "";
}
