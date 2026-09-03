/**
 * CoinGecko `/coins/{id}/market_chart` → one USD price per UTC day. Granularity is automatic on the
 * free tier (≤1 day: 5-min, 2–90 days: hourly, >90 days: daily at 00:00 UTC plus a final "now"
 * point), so we normalise every response the same way: the FIRST point on each UTC day. That is the
 * 00:00 UTC value whether the series was daily or hourly, which keeps backfill (365 days) and the
 * indexer's short refresh (3 days) consistent for the same day.
 */

/** [unix ms, usd] as returned by CoinGecko. */
export type MarketChartPoint = [number, number];

export interface DayPrice {
  day: string;
  usd: number;
}

/** Earliest point per UTC calendar day; malformed points are skipped. Output sorted by day. */
export function bucketPricePointsByUtcDay(points: readonly MarketChartPoint[]): DayPrice[] {
  const first = new Map<string, { ms: number; usd: number }>();
  for (const p of points) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const [ms, usd] = p;
    if (!Number.isFinite(ms) || !Number.isFinite(usd) || usd < 0) continue;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) continue; // outside the Date range → toISOString would throw
    const day = date.toISOString().slice(0, 10);
    const cur = first.get(day);
    if (!cur || ms < cur.ms) first.set(day, { ms, usd });
  }
  return [...first.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([day, v]) => ({ day, usd: v.usd }));
}

export type MarketChartStatus = "ok" | "not_found" | "rate_limited" | "error";

export interface MarketChartResult {
  status: MarketChartStatus;
  rows: DayPrice[];
  /** HTTP status or error message for logs. */
  detail?: string;
}

function coingeckoHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" };
  const key = process.env.COINGECKO_API_KEY;
  if (key) h["x-cg-demo-api-key"] = key;
  return h;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

const DEFAULT_RETRY_AFTER_MS = 65_000;
const MAX_ATTEMPTS = 3;

/**
 * Fetch `days` of history for one coin id (free tier allows ≤ 365). Retries 429 using Retry-After
 * (default 65 s) up to MAX_ATTEMPTS; other failures return `error`/`not_found` without throwing.
 */
export async function fetchMarketChartDailyUsd(
  coingeckoId: string,
  days: number,
  fetchImpl: typeof fetch = fetch
): Promise<MarketChartResult> {
  const url = new URL(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coingeckoId)}/market_chart`);
  url.searchParams.set("vs_currency", "usd");
  url.searchParams.set("days", String(Math.max(1, Math.min(365, Math.floor(days)))));

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(url.toString(), { headers: coingeckoHeaders(), cache: "no-store" });
    } catch (e) {
      return { status: "error", rows: [], detail: e instanceof Error ? e.message : String(e) };
    }
    if (res.status === 429) {
      if (attempt === MAX_ATTEMPTS) return { status: "rate_limited", rows: [], detail: "429 after retries" };
      const ra = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : DEFAULT_RETRY_AFTER_MS);
      continue;
    }
    if (res.status === 404) return { status: "not_found", rows: [], detail: "404" };
    if (!res.ok) return { status: "error", rows: [], detail: `HTTP ${res.status}` };
    let body: { prices?: unknown };
    try {
      body = (await res.json()) as { prices?: unknown };
    } catch {
      return { status: "error", rows: [], detail: "invalid JSON" };
    }
    const prices = Array.isArray(body.prices) ? (body.prices as MarketChartPoint[]) : [];
    return { status: "ok", rows: bucketPricePointsByUtcDay(prices) };
  }
  return { status: "error", rows: [], detail: "unreachable" };
}
