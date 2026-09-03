/**
 * Q3 — "Is value flowing in or out?" Net IBC flow per asset = `ibc_transfer_amount_in` −
 * `ibc_transfer_amount_out`, Agoric-relative (in = recv packets credited here, out = MsgTransfer from
 * here). Native amounts are never summed across denoms; the headline sums USD, with every (denom,
 * day) leg priced at its own day's row via the shared `UsdPricer`. Gross flow, not TVL.
 *
 * Two grains: the per-bucket native series follows the chart granularity (hour / day / week), while
 * range totals, USD, and the daily series for anomalies are day-grain from the context map.
 */
import type { DayValue } from "@/lib/anomalies";
import { type DayBucketMap } from "@/lib/organicActivity";
import { usdForLeg, type UsdPricer } from "@/lib/denomPrices";
import type { EnrichedDisplay } from "@/lib/metricsDisplayTypes";
import { SERIES } from "@/lib/semantics";

export interface NetIbcAsset {
  denom: string;
  /** Native atomic totals over the range (strings; `net` is signed). `out` includes orchestration sends. */
  in: string;
  out: string;
  /** Of `out`, the part executed by orchestration in EndBlock (ibc_transfer_amount_out_orch). */
  outOrch: string;
  net: string;
  /** Day-priced USD; null when the denom is unmapped or no day could be priced. */
  inUsd: number | null;
  outUsd: number | null;
  netUsd: number | null;
}

export interface NetIbcBucketPoint {
  bucket: string;
  in: string;
  out: string;
  net: string;
}

export interface NetIbcFlow {
  /** Range net USD across priced assets, vs the prior window; `delta` is absolute (net can change sign). */
  headline: {
    netUsd: number | null;
    previousNetUsd: number | null;
    deltaUsd: number | null;
    inUsd: number | null;
    /** Total outflow USD (user MsgTransfer + orchestration EndBlock sends). */
    outUsd: number | null;
    /** Of outUsd, orchestration-originated. */
    outOrchUsd: number | null;
  };
  /** Priced assets first by |netUsd| desc, then unpriced by max(in, out) native desc. */
  byAsset: NetIbcAsset[];
  /** Chart-grain native series for the top assets (by the same order), `topN` of them. */
  perBucket: { denom: string; data: NetIbcBucketPoint[] }[];
  /** Day-grain net USD across priced assets over the context window (0 = no legs; null = legs but none priced). */
  dailyNetUsd: DayValue[];
}

type Totals = Map<string, { in: bigint; out: bigint; outOrch: bigint }>;

function totalsOverDays(ctx: DayBucketMap, days: readonly string[]): Totals {
  const t: Totals = new Map();
  for (const d of days) {
    const sm = ctx.get(d);
    if (!sm) continue;
    for (const [series, key] of [
      [SERIES.IBC_TRANSFER_AMOUNT_IN, "in"],
      [SERIES.IBC_TRANSFER_AMOUNT_OUT, "out"],
      [SERIES.IBC_TRANSFER_AMOUNT_OUT_ORCH, "outOrch"],
    ] as const) {
      const dm = sm.get(series);
      if (!dm) continue;
      for (const [denom, v] of dm) {
        if (v <= BigInt(0)) continue;
        const cur = t.get(denom) ?? { in: BigInt(0), out: BigInt(0), outOrch: BigInt(0) };
        if (key === "outOrch") {
          cur.outOrch += v;
          cur.out += v;
        } else cur[key] += v;
        t.set(denom, cur);
      }
    }
  }
  return t;
}

/** Sum day-priced in/out USD per denom over `days`; a denom is priced if any of its legs priced. */
function usdOverDays(
  ctx: DayBucketMap,
  days: readonly string[],
  display: EnrichedDisplay,
  denomToCoinId: Map<string, string>,
  pricer: UsdPricer
): Map<string, { inUsd: number | null; outUsd: number | null; outOrchUsd: number | null }> {
  const out = new Map<string, { inUsd: number | null; outUsd: number | null; outOrchUsd: number | null }>();
  for (const d of days) {
    const sm = ctx.get(d);
    if (!sm) continue;
    for (const [series, key] of [
      [SERIES.IBC_TRANSFER_AMOUNT_IN, "inUsd"],
      [SERIES.IBC_TRANSFER_AMOUNT_OUT, "outUsd"],
      [SERIES.IBC_TRANSFER_AMOUNT_OUT_ORCH, "outOrchUsd"],
    ] as const) {
      const dm = sm.get(series);
      if (!dm) continue;
      for (const [denom, v] of dm) {
        if (v <= BigInt(0)) continue;
        const u = usdForLeg(denom, d, v, display, denomToCoinId, pricer);
        const cur = out.get(denom) ?? { inUsd: null, outUsd: null, outOrchUsd: null };
        if (u !== null) {
          cur[key] = (cur[key] ?? 0) + u;
          if (key === "outOrchUsd") cur.outUsd = (cur.outUsd ?? 0) + u; // orchestration is part of total out
        }
        out.set(denom, cur);
      }
    }
  }
  return out;
}

function sumNullable(values: (number | null)[]): number | null {
  let s = 0;
  let any = false;
  for (const v of values) {
    if (v === null) continue;
    s += v;
    any = true;
  }
  return any ? s : null;
}

function netUsdOf(u: { inUsd: number | null; outUsd: number | null; outOrchUsd?: number | null }): number | null {
  if (u.inUsd === null && u.outUsd === null) return null;
  return (u.inUsd ?? 0) - (u.outUsd ?? 0);
}

function maxBig(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

export function buildNetIbcFlow(input: {
  dailyContext: DayBucketMap;
  days: readonly string[];
  prevDays: readonly string[];
  contextDays: readonly string[];
  /** Chart-grain buckets for the selected range. */
  curBuckets: Map<string, Map<string, Map<string, bigint>>>;
  display: EnrichedDisplay;
  denomToCoinId: Map<string, string>;
  pricer: UsdPricer;
  topN?: number;
}): NetIbcFlow {
  const { dailyContext, days, prevDays, contextDays, curBuckets, display, denomToCoinId, pricer } = input;
  const topN = input.topN ?? 5;

  const totals = totalsOverDays(dailyContext, days);
  const usd = usdOverDays(dailyContext, days, display, denomToCoinId, pricer);
  const prevUsd = usdOverDays(dailyContext, prevDays, display, denomToCoinId, pricer);

  const byAsset: NetIbcAsset[] = [...totals.entries()].map(([denom, t]) => {
    const u = usd.get(denom) ?? { inUsd: null, outUsd: null, outOrchUsd: null };
    return {
      denom,
      in: t.in.toString(),
      out: t.out.toString(),
      outOrch: t.outOrch.toString(),
      net: (t.in - t.out).toString(),
      inUsd: u.inUsd,
      outUsd: u.outUsd,
      netUsd: netUsdOf(u),
    };
  });
  byAsset.sort((a, b) => {
    if (a.netUsd !== null && b.netUsd !== null) return Math.abs(b.netUsd) - Math.abs(a.netUsd);
    if (a.netUsd !== null) return -1;
    if (b.netUsd !== null) return 1;
    const am = maxBig(BigInt(a.in), BigInt(a.out));
    const bm = maxBig(BigInt(b.in), BigInt(b.out));
    return bm > am ? 1 : bm < am ? -1 : 0;
  });

  const bucketKeys = [...curBuckets.keys()].sort();
  const perBucket = byAsset.slice(0, topN).map(({ denom }) => ({
    denom,
    data: bucketKeys.map((bucket) => {
      const sm = curBuckets.get(bucket);
      const i = sm?.get(SERIES.IBC_TRANSFER_AMOUNT_IN)?.get(denom) ?? BigInt(0);
      const o =
        (sm?.get(SERIES.IBC_TRANSFER_AMOUNT_OUT)?.get(denom) ?? BigInt(0)) +
        (sm?.get(SERIES.IBC_TRANSFER_AMOUNT_OUT_ORCH)?.get(denom) ?? BigInt(0));
      return { bucket, in: i.toString(), out: o.toString(), net: (i - o).toString() };
    }),
  }));

  const dailyNetUsd: DayValue[] = contextDays.map((day) => {
    const dayUsd = usdOverDays(dailyContext, [day], display, denomToCoinId, pricer);
    if (dayUsd.size === 0) return { day, value: 0 };
    return { day, value: sumNullable([...dayUsd.values()].map(netUsdOf)) };
  });

  const inUsd = sumNullable([...usd.values()].map((u) => u.inUsd));
  const outUsd = sumNullable([...usd.values()].map((u) => u.outUsd));
  const outOrchUsd = sumNullable([...usd.values()].map((u) => u.outOrchUsd));
  const netUsd = sumNullable(byAsset.map((a) => a.netUsd));
  const previousNetUsd = sumNullable([...prevUsd.values()].map(netUsdOf));

  return {
    headline: {
      netUsd,
      previousNetUsd,
      deltaUsd: netUsd !== null && previousNetUsd !== null ? netUsd - previousNetUsd : null,
      inUsd,
      outUsd,
      outOrchUsd,
    },
    byAsset,
    perBucket,
    dailyNetUsd,
  };
}
