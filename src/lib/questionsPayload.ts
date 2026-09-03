/**
 * The `questions` section of /api/metrics: the four headline questions, each with one headline
 * figure (prior-window comparison), a day-grain series over the context window, anomaly flags, and a
 * few supporting figures. Pure assembly over inputs the route fetches once; every number here is
 * derived from rollups that already exist (see docs: "Four Questions", P1).
 *
 *   Q1 busier      — successful txs
 *   Q2 organic     — interactive ÷ all wallet actions
 *   Q3 value-flow  — net IBC flow in USD (in − out), day-priced
 *   Q4 base        — effective number of fee payers (1 / HHI of day-priced fee USD)
 *
 * Day-grain by design: the context map is daily regardless of chart granularity, so the prior
 * window and the 30-day anomaly lookback are the same shape for every question.
 */
import { DEFAULT_ANOMALY_OPTIONS, trailingZScores, type AnomalyOptions, type AnomalyPoint, type DayValue } from "@/lib/anomalies";
import { effectiveNumberFromHhi, herfindahlFromWeights } from "@/lib/concentrationMath";
import { utcDaysInclusive, usdForLeg, type DailyPriceTable, type UsdPricingMeta } from "@/lib/denomPrices";
import type { EnrichedDisplay } from "@/lib/metricsDisplayTypes";
import { buildNetIbcFlow, type NetIbcFlow } from "@/lib/netIbcFlow";
import { buildOrganicActivity, type DayBucketMap, type OrganicActivity } from "@/lib/organicActivity";
import type { RetentionCounts } from "@/lib/participationQueries";
import { buildRetention, type Retention } from "@/lib/retention";
import { FEE_DENOM_UBLB, SERIES } from "@/lib/semantics";

export interface Delta {
  current: number | null;
  previous: number | null;
  /** (current − previous) ÷ previous × 100; 0 when both are 0; null when previous is 0 or either is null. */
  pctChange: number | null;
}

export interface QuestionsPayload {
  /** First day of the day-grain context (prior window and anomaly lookback both fit inside). */
  contextFromDay: string;
  comparisonWindow: { from: string; to: string };
  anomalyRule: { windowDays: number; minPoints: number; threshold: number };
  q1: {
    id: "busier";
    headline: Delta;
    daily: DayValue[];
    anomalies: AnomalyPoint[];
    support: {
      distinctAccountsPerDayAvg: Delta;
      failureRatePct: { current: number | null; previous: number | null };
      feePaidBld: Delta;
    };
  };
  q2: {
    id: "organic";
    headline: OrganicActivity["ratioPct"];
    counts: OrganicActivity["counts"];
    daily: DayValue[];
    dailyCounts: OrganicActivity["dailyCounts"];
    anomalies: AnomalyPoint[];
  };
  q3: {
    id: "value-flow";
    headline: NetIbcFlow["headline"];
    byAsset: NetIbcFlow["byAsset"];
    perBucket: NetIbcFlow["perBucket"];
    daily: DayValue[];
    anomalies: AnomalyPoint[];
    usdPricingMeta: UsdPricingMeta;
  };
  q4: {
    id: "base";
    /** Effective number of fee payers over the range (1 / HHI of day-priced fee USD). */
    headline: Delta;
    /** Same measure on the gross-movement basis, range only (from the concentration section). */
    effectiveNGross: number | null;
    retention: Retention;
    support: { top10FeeSharePct: number | null; multiDayInRange: number };
    daily: DayValue[];
    anomalies: AnomalyPoint[];
    usdPricingMeta: UsdPricingMeta;
  };
}

export interface QuestionsBuildInput {
  fromDay: string;
  toDay: string;
  prevFromDay: string;
  prevToDay: string;
  contextFromDay: string;
  /** Day-grain buckets covering [contextFromDay, toDay]. */
  dailyContext: DayBucketMap;
  /** Chart-grain buckets for the selected range (for Q3's per-bucket series). */
  curBuckets: Map<string, Map<string, Map<string, bigint>>>;
  display: EnrichedDisplay;
  denomToCoinId: Map<string, string>;
  table: DailyPriceTable;
  /** Distinct signer ∪ fee-payer addresses per day over the context window (sparse). */
  distinctUnionPerDay: { day: string; count: number }[];
  retention: { current: RetentionCounts; previous: RetentionCounts };
  /** day → address → denom → paid fee over the context window (module accounts excluded). */
  feeByDay: Map<string, Map<string, Map<string, bigint>>>;
  grossUsdHhi: number | null;
  top10FeeSharePct: number | null;
  multiDayInRange: number;
  anomalyOptions?: AnomalyOptions;
  /** Current UTC day (YYYY-MM-DD); it is incomplete, so it is never flagged as an anomaly. Defaults to now. */
  todayUtc?: string;
}

export function pctChangeNum(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

export function delta(current: number | null, previous: number | null): Delta {
  return { current, previous, pctChange: pctChangeNum(current, previous) };
}

function seriesOverDays(ctx: DayBucketMap, days: readonly string[], series: string, dimension = ""): number {
  let t = BigInt(0);
  for (const d of days) t += ctx.get(d)?.get(series)?.get(dimension) ?? BigInt(0);
  return Number(t);
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Effective-N of fee payers for a set of days: per-address day-priced USD totals → HHI → 1/H. */
function feeEffectiveN(
  feeByDay: QuestionsBuildInput["feeByDay"],
  days: readonly string[],
  display: EnrichedDisplay,
  denomToCoinId: Map<string, string>,
  pricer: ReturnType<DailyPriceTable["pricer"]>
): number | null {
  const byAddr = new Map<string, number>();
  for (const d of days) {
    const byAddrDenom = feeByDay.get(d);
    if (!byAddrDenom) continue;
    for (const [addr, byDenom] of byAddrDenom) {
      let u = 0;
      for (const [denom, atomic] of byDenom) u += usdForLeg(denom, d, atomic, display, denomToCoinId, pricer) ?? 0;
      if (u > 0) byAddr.set(addr, (byAddr.get(addr) ?? 0) + u);
    }
  }
  return effectiveNumberFromHhi(herfindahlFromWeights([...byAddr.values()]));
}

export function buildQuestions(input: QuestionsBuildInput): QuestionsPayload {
  const { dailyContext, display, denomToCoinId, table } = input;
  const days = utcDaysInclusive(input.fromDay, input.toDay);
  const prevDays = utcDaysInclusive(input.prevFromDay, input.prevToDay);
  const contextDays = utcDaysInclusive(input.contextFromDay, input.toDay);
  const anomalyOpts: AnomalyOptions = {
    ...DEFAULT_ANOMALY_OPTIONS,
    ...input.anomalyOptions,
    flagFromDay: input.fromDay,
    flagBeforeDay: input.todayUtc ?? new Date().toISOString().slice(0, 10),
  };
  const flags = (daily: DayValue[]) => trailingZScores(daily, anomalyOpts).flagged;

  // Q1 — busier
  const txCur = seriesOverDays(dailyContext, days, SERIES.TX_SUCCESS);
  const txPrev = seriesOverDays(dailyContext, prevDays, SERIES.TX_SUCCESS);
  const failedCur = seriesOverDays(dailyContext, days, SERIES.TX_FAILED);
  const failedPrev = seriesOverDays(dailyContext, prevDays, SERIES.TX_FAILED);
  const failureRate = (f: number, s: number) => (f + s > 0 ? (f / (f + s)) * 100 : null);
  const feeDec = display.metas[FEE_DENOM_UBLB]?.decimals ?? 6;
  const feeBld = (ds: readonly string[]) => seriesOverDays(dailyContext, ds, SERIES.FEE_PAID, FEE_DENOM_UBLB) / 10 ** feeDec;
  const accountsByDay = new Map(input.distinctUnionPerDay.map((r) => [r.day, r.count]));
  const accountsAvg = (ds: readonly string[]) => mean(ds.map((d) => accountsByDay.get(d) ?? 0));
  const txDaily: DayValue[] = contextDays.map((day) => ({ day, value: seriesOverDays(dailyContext, [day], SERIES.TX_SUCCESS) }));

  // Q2 — organic
  const organic = buildOrganicActivity(dailyContext, days, prevDays, contextDays);

  // Q3 — value flow
  const q3Pricer = table.pricer();
  const flow = buildNetIbcFlow({
    dailyContext,
    days,
    prevDays,
    contextDays,
    curBuckets: input.curBuckets,
    display,
    denomToCoinId,
    pricer: q3Pricer,
  });

  // Q4 — base
  const q4Pricer = table.pricer();
  const effNCur = feeEffectiveN(input.feeByDay, days, display, denomToCoinId, q4Pricer);
  const effNPrev = feeEffectiveN(input.feeByDay, prevDays, display, denomToCoinId, q4Pricer);
  const effNDaily: DayValue[] = contextDays.map((day) => ({
    day,
    value: feeEffectiveN(input.feeByDay, [day], display, denomToCoinId, q4Pricer),
  }));

  return {
    contextFromDay: input.contextFromDay,
    comparisonWindow: { from: input.prevFromDay, to: input.prevToDay },
    anomalyRule: {
      windowDays: anomalyOpts.windowDays ?? DEFAULT_ANOMALY_OPTIONS.windowDays,
      minPoints: anomalyOpts.minPoints ?? DEFAULT_ANOMALY_OPTIONS.minPoints,
      threshold: anomalyOpts.threshold ?? DEFAULT_ANOMALY_OPTIONS.threshold,
    },
    q1: {
      id: "busier",
      headline: delta(txCur, txPrev),
      daily: txDaily,
      anomalies: flags(txDaily),
      support: {
        distinctAccountsPerDayAvg: delta(accountsAvg(days), accountsAvg(prevDays)),
        failureRatePct: { current: failureRate(failedCur, txCur), previous: failureRate(failedPrev, txPrev) },
        feePaidBld: delta(feeBld(days), feeBld(prevDays)),
      },
    },
    q2: {
      id: "organic",
      headline: organic.ratioPct,
      counts: organic.counts,
      daily: organic.dailyRatioPct,
      dailyCounts: organic.dailyCounts,
      anomalies: flags(organic.dailyRatioPct),
    },
    q3: {
      id: "value-flow",
      headline: flow.headline,
      byAsset: flow.byAsset,
      perBucket: flow.perBucket,
      daily: flow.dailyNetUsd,
      anomalies: flags(flow.dailyNetUsd),
      usdPricingMeta: q3Pricer.meta(),
    },
    q4: {
      id: "base",
      headline: delta(effNCur, effNPrev),
      effectiveNGross: effectiveNumberFromHhi(input.grossUsdHhi),
      retention: buildRetention(input.retention.current, input.retention.previous),
      support: { top10FeeSharePct: input.top10FeeSharePct, multiDayInRange: input.multiDayInRange },
      daily: effNDaily,
      anomalies: flags(effNDaily),
      usdPricingMeta: q4Pricer.meta(),
    },
  };
}
