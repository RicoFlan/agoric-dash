import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { dailyMetrics, hourlyMetrics, indexerState } from "@/db/schema";
import {
  seriesIbcMsgCombinedOverTime,
  seriesIbcRecvDisplayOverTime,
  sumIbcRecvDisplay,
} from "@/lib/ibcRollupDisplay";
import { FEE_DENOM_UBLB, SERIES } from "@/lib/semantics";
import { successRatePct } from "@/lib/txSuccessRate";
import { blockGasUtilizationPct, gasEfficiencyPct } from "@/lib/gasEfficiency";
import { buildOffersSection } from "@/lib/offersMetrics";
import { queryOfferParticipantsRange } from "@/lib/offersQuery";
import type { DayDenomAmounts } from "@/lib/denomPrices";
import { DEFAULT_ANOMALY_OPTIONS } from "@/lib/anomalies";

export type Granularity = "hour" | "day" | "week";

function parseDay(s: string): string {
  return s.slice(0, 10);
}

/** Monday UTC date for the week containing isoDay */
function mondayBucket(isoDay: string): string {
  const d = new Date(isoDay + "T12:00:00Z");
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

export async function getIndexerStatus() {
  const rows = await db
    .select()
    .from(indexerState)
    .where(eq(indexerState.id, "singleton"))
    .limit(1);
  const row = rows[0];
  return {
    lastIndexedHeight: row?.lastIndexedHeight?.toString() ?? null,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  };
}

type BucketKey = string;

type FlatMetric = {
  bucket: BucketKey;
  series: string;
  dimension: string;
  value: string;
};

async function fetchMetricsRange(fromDay: string, toDay: string) {
  return db
    .select()
    .from(dailyMetrics)
    .where(and(gte(dailyMetrics.day, fromDay), lte(dailyMetrics.day, toDay)));
}

function dailyRowsToFlat(
  rows: { day: string; series: string; dimension: string; value: string }[],
  granularity: "day" | "week"
): FlatMetric[] {
  return rows.map((r) => {
    const d = parseDay(r.day);
    const bucket = granularity === "day" ? d : mondayBucket(d);
    return { bucket, series: r.series, dimension: r.dimension, value: r.value };
  });
}

function mapHourlyDbToFlat(
  rows: { hour: Date; series: string; dimension: string; value: string }[]
): FlatMetric[] {
  return rows.map((r) => ({
    bucket: hourKeyFromDate(r.hour),
    series: r.series,
    dimension: r.dimension,
    value: r.value,
  }));
}

function hourKeyFromDate(d: Date): string {
  const x = new Date(d);
  x.setUTCMilliseconds(0);
  x.setUTCSeconds(0, 0);
  x.setUTCMinutes(0, 0);
  return x.toISOString();
}

async function fetchHourlyRange(fromInclusive: Date, toInclusive: Date) {
  return db
    .select()
    .from(hourlyMetrics)
    .where(and(gte(hourlyMetrics.hour, fromInclusive), lte(hourlyMetrics.hour, toInclusive)));
}

/** Every UTC calendar day from `fromDay` through `toDay` inclusive (YYYY-MM-DD). */
export function iterateUtcDaysInclusive(fromDay: string, toDay: string): string[] {
  const fd = fromDay.slice(0, 10);
  const td = toDay.slice(0, 10);
  const start = new Date(`${fd}T00:00:00.000Z`);
  const end = new Date(`${td}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }
  const out: string[] = [];
  for (let d = new Date(start); d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Ensure each UTC calendar day in [fromDay, toDay] exists as a bucket key so charts/KPIs include
 * days with no `daily_metrics` rows (zeros) instead of shortening the axis.
 */
export function ensureDenseUtcDayBuckets(
  bucketMap: Map<string, Map<string, Map<string, bigint>>>,
  fromDay: string,
  toDay: string
) {
  for (const day of iterateUtcDaysInclusive(fromDay, toDay)) {
    if (!bucketMap.has(day)) {
      bucketMap.set(day, new Map());
    }
  }
}

/** Collapse per-day (or per-week) rows from daily_metrics into bucket keys, then sum. */
function aggregateFlatRows(
  flat: FlatMetric[]
): Map<string, Map<string, Map<string, bigint>>> {
  const out = new Map<string, Map<string, Map<string, bigint>>>();
  for (const r of flat) {
    if (!out.has(r.bucket)) out.set(r.bucket, new Map());
    const sm = out.get(r.bucket)!;
    if (!sm.has(r.series)) sm.set(r.series, new Map());
    const dm = sm.get(r.series)!;
    const cur = dm.get(r.dimension) ?? BigInt(0);
    dm.set(r.dimension, cur + BigInt(r.value));
  }
  return out;
}

function sumSeries(
  bucketMap: Map<string, Map<string, Map<string, bigint>>>,
  series: string,
  dimension = ""
): bigint {
  let t = BigInt(0);
  for (const sm of bucketMap.values()) {
    const dm = sm.get(series);
    if (!dm) continue;
    t += dm.get(dimension) ?? BigInt(0);
  }
  return t;
}

function seriesOverTime(
  bucketMap: Map<string, Map<string, Map<string, bigint>>>,
  series: string,
  dimension = ""
): { bucket: string; value: string }[] {
  const keys = [...bucketMap.keys()].sort();
  return keys.map((bucket) => ({
    bucket,
    value: (bucketMap.get(bucket)?.get(series)?.get(dimension) ?? BigInt(0)).toString(),
  }));
}

/**
 * Same basis as `transferVolumeTableByDenom`: per bucket, transfer-like msgs + IBC recv for `denom`.
 * Keeps the gross in-tx movement chart aligned with the range-total table (not TV-only).
 */
function seriesTransferVolumePlusIbcRecv(
  bucketMap: Map<string, Map<string, Map<string, bigint>>>,
  denom: string
): { bucket: string; value: string }[] {
  const keys = [...bucketMap.keys()].sort();
  return keys.map((bucket) => {
    const tv =
      bucketMap.get(bucket)?.get(SERIES.TRANSFER_VOLUME)?.get(denom) ?? BigInt(0);
    const ibcIn =
      bucketMap.get(bucket)?.get(SERIES.IBC_TRANSFER_AMOUNT_IN)?.get(denom) ?? BigInt(0);
    return { bucket, value: (tv + ibcIn).toString() };
  });
}

function pctChange(current: bigint, previous: bigint): number | null {
  if (previous === BigInt(0)) return current === BigInt(0) ? 0 : null;
  return Number((current - previous) * BigInt(10000) / previous) / 100;
}

export async function buildMetricsPayload(
  from: string,
  to: string,
  granularity: Granularity
) {
  const fromDay = parseDay(from);
  const toDay = parseDay(to);

  const msPerDay = 86400000;
  const fromMs = new Date(fromDay + "T00:00:00Z").getTime();
  /** Inclusive calendar days in [fromDay, toDay]; both at 00:00Z so a 19-day range yields 19, not 20. */
  const windowDays = Math.max(1, Math.round((new Date(toDay + "T00:00:00Z").getTime() - fromMs) / msPerDay) + 1);
  const prevToMs = fromMs - msPerDay;
  const prevFromMs = prevToMs - (windowDays - 1) * msPerDay;
  const prevFromDay = new Date(prevFromMs).toISOString().slice(0, 10);
  const prevToDay = new Date(prevToMs).toISOString().slice(0, 10);

  /**
   * Day-grain context for the `questions` section: the prior window plus the anomaly lookback,
   * whichever starts earlier. Fetched once as daily rows regardless of chart granularity.
   */
  const lookbackFromMs = fromMs - DEFAULT_ANOMALY_OPTIONS.windowDays * msPerDay;
  const contextFromDay = new Date(Math.min(prevFromMs, lookbackFromMs)).toISOString().slice(0, 10);
  const contextToDayExclusive = new Date(fromMs - msPerDay).toISOString().slice(0, 10);
  const contextRowsPromise = fetchMetricsRange(contextFromDay, contextToDayExclusive);

  let curBuckets: Map<string, Map<string, Map<string, bigint>>>;
  let prevBuckets: Map<string, Map<string, Map<string, bigint>>>;
  let comparisonWindow: { from: string; to: string };

  /** Always fetch daily rows for [fromDay,toDay] — used for transfer-volume table totals (below). */
  let currentDailyRows: Awaited<ReturnType<typeof fetchMetricsRange>>;
  let usedDailyFallbackForHourView = false;

  if (granularity === "hour") {
    const fromStart = new Date(fromDay + "T00:00:00.000Z");
    const toEnd = new Date(toDay + "T23:00:00.000Z");
    const nHours =
      Math.round((toEnd.getTime() - fromStart.getTime()) / 3_600_000) + 1;
    const prevTo = new Date(fromStart.getTime() - 3_600_000);
    const prevFrom = new Date(fromStart.getTime() - nHours * 3_600_000);
    const [dailyRows, curH, prevH] = await Promise.all([
      fetchMetricsRange(fromDay, toDay),
      fetchHourlyRange(fromStart, toEnd),
      fetchHourlyRange(prevFrom, prevTo),
    ]);
    currentDailyRows = dailyRows;
    curBuckets = aggregateFlatRows(mapHourlyDbToFlat(curH));
    prevBuckets = aggregateFlatRows(mapHourlyDbToFlat(prevH));

    /** Hourly table empty but daily rollups exist (older DB / indexer gap) — use daily buckets so KPIs and charts are not all zero. */
    if (curBuckets.size === 0 && dailyRows.length > 0) {
      usedDailyFallbackForHourView = true;
      const prevFromDayH = prevFrom.toISOString().slice(0, 10);
      const prevToDayH = prevTo.toISOString().slice(0, 10);
      const prevDailyRows = await fetchMetricsRange(prevFromDayH, prevToDayH);
      curBuckets = aggregateFlatRows(dailyRowsToFlat(dailyRows, "day"));
      prevBuckets = aggregateFlatRows(dailyRowsToFlat(prevDailyRows, "day"));
      ensureDenseUtcDayBuckets(curBuckets, fromDay, toDay);
      ensureDenseUtcDayBuckets(prevBuckets, prevFromDayH, prevToDayH);
    }

    comparisonWindow = { from: prevFrom.toISOString(), to: prevTo.toISOString() };
  } else {
    const [dailyRows, prevRows] = await Promise.all([
      fetchMetricsRange(fromDay, toDay),
      fetchMetricsRange(prevFromDay, prevToDay),
    ]);
    currentDailyRows = dailyRows;
    const g = granularity;
    const curFlat = dailyRowsToFlat(currentDailyRows, g);
    const prevFlat = dailyRowsToFlat(prevRows, g);
    curBuckets = aggregateFlatRows(curFlat);
    prevBuckets = aggregateFlatRows(prevFlat);
    comparisonWindow = { from: prevFromDay, to: prevToDay };
    if (g === "day") {
      ensureDenseUtcDayBuckets(curBuckets, fromDay, toDay);
      ensureDenseUtcDayBuckets(prevBuckets, prevFromDay, prevToDay);
    }
  }

  /** Table + USD enrichment: always daily rollups for the calendar range (stable vs chart granularity). */
  const transferTableBuckets = aggregateFlatRows(dailyRowsToFlat(currentDailyRows, "day"));
  ensureDenseUtcDayBuckets(transferTableBuckets, fromDay, toDay);

  const dailyContext = aggregateFlatRows(dailyRowsToFlat([...(await contextRowsPromise), ...currentDailyRows], "day"));
  ensureDenseUtcDayBuckets(dailyContext, contextFromDay, toDay);
  /** Inputs for `buildQuestions` (route-side); day-grain, stripped from the response like pricingInputs. */
  const questionsInputs = { dailyContext, contextFromDay, prevFromDay, prevToDay, curBuckets };

  /**
   * Day-grain native amounts per denom for day-accurate USD pricing (`src/lib/denomPrices.ts`).
   * Same daily basis as the table totals; the API route consumes and strips these before responding.
   */
  const pricingInputs = {
    transferVolumeByDayDenom: dayDenomAmounts(transferTableBuckets, [SERIES.TRANSFER_VOLUME, SERIES.IBC_TRANSFER_AMOUNT_IN]),
    bankCreditsByDayDenom: dayDenomAmounts(transferTableBuckets, [SERIES.BANK_CREDITS_VOLUME]),
    offerGiveByDayDenom: dayDenomAmounts(transferTableBuckets, [SERIES.OFFER_GIVE_VOLUME]),
    offerWantByDayDenom: dayDenomAmounts(transferTableBuckets, [SERIES.OFFER_WANT_VOLUME]),
    offerPayoutByDayDenom: dayDenomAmounts(transferTableBuckets, [SERIES.OFFER_PAYOUT_VOLUME]),
  };

  const txSuccessCur = sumSeries(curBuckets, SERIES.TX_SUCCESS);
  const txSuccessPrev = sumSeries(prevBuckets, SERIES.TX_SUCCESS);

  const txFailedCur = sumSeries(curBuckets, SERIES.TX_FAILED);
  const txFailedPrev = sumSeries(prevBuckets, SERIES.TX_FAILED);

  const gasCur = sumSeries(curBuckets, SERIES.GAS_USED);
  const gasPrev = sumSeries(prevBuckets, SERIES.GAS_USED);

  const gasWantedCur = sumSeries(curBuckets, SERIES.GAS_WANTED);
  const gasWantedPrev = sumSeries(prevBuckets, SERIES.GAS_WANTED);

  const blockGasLimitCur = sumSeries(curBuckets, SERIES.BLOCK_GAS_LIMIT);
  const blockGasLimitPrev = sumSeries(prevBuckets, SERIES.BLOCK_GAS_LIMIT);

  const ibcOutCur = sumSeries(curBuckets, SERIES.IBC_TRANSFER_OUT_COUNT);
  const ibcOutPrev = sumSeries(prevBuckets, SERIES.IBC_TRANSFER_OUT_COUNT);

  const ibcInCur = sumIbcRecvDisplay(curBuckets);
  const ibcInPrev = sumIbcRecvDisplay(prevBuckets);

  /** Sum fees across all denoms (native units per denom kept separate in breakdown) */
  function sumAllFees(m: Map<string, Map<string, Map<string, bigint>>>) {
    let t = BigInt(0);
    const sm = aggregateDenomSeries(m, SERIES.FEE_PAID);
    for (const v of sm.values()) t += BigInt(v);
    return t;
  }

  /** Count KPI (current/previous/pctChange) for a single-dimension series like staking/gov counts. */
  function countKpi(series: string) {
    const cur = sumSeries(curBuckets, series);
    const prev = sumSeries(prevBuckets, series);
    return { current: cur.toString(), previous: prev.toString(), pctChange: pctChange(cur, prev) };
  }

  const feeCur = sumAllFees(curBuckets);
  const feePrev = sumAllFees(prevBuckets);
  const feeUbldCur = sumSeries(curBuckets, SERIES.FEE_PAID, FEE_DENOM_UBLB);
  const feeUbldPrev = sumSeries(prevBuckets, SERIES.FEE_PAID, FEE_DENOM_UBLB);

  const txTotal = seriesOverTime(curBuckets, SERIES.TX_SUCCESS);
  const txFailedOverTime = seriesOverTime(curBuckets, SERIES.TX_FAILED);
  const ibcMsgCombined = seriesIbcMsgCombinedOverTime(curBuckets);
  const ibcOutSeries = seriesOverTime(curBuckets, SERIES.IBC_TRANSFER_OUT_COUNT);
  const ibcInSeries = seriesIbcRecvDisplayOverTime(curBuckets);

  /** Raw per-bucket gas series — combined client-side into efficiency / block-space utilization % trends. */
  const gasUsedOverTime = seriesOverTime(curBuckets, SERIES.GAS_USED);
  const gasWantedOverTime = seriesOverTime(curBuckets, SERIES.GAS_WANTED);
  const blockGasLimitOverTime = seriesOverTime(curBuckets, SERIES.BLOCK_GAS_LIMIT);

  /** Per-bucket staking & governance message counts for the activity trend chart. */
  const stakingGovOverTime = {
    delegations: seriesOverTime(curBuckets, SERIES.STAKING_DELEGATIONS),
    undelegations: seriesOverTime(curBuckets, SERIES.STAKING_UNDELEGATIONS),
    redelegations: seriesOverTime(curBuckets, SERIES.STAKING_REDELEGATIONS),
    govVotes: seriesOverTime(curBuckets, SERIES.GOV_VOTES),
    govProposals: seriesOverTime(curBuckets, SERIES.GOV_PROPOSALS),
  };

  /** SwingSet/Zoe offers: KPIs, category/source/instance/maker/target breakdowns, and trend. */
  const offersSection = buildOffersSection(curBuckets, prevBuckets);
  /** Distinct offer-submitting wallets (daily-grain table) over the calendar range. */
  const offerParticipants = await queryOfferParticipantsRange(fromDay, toDay);

  const feeByDenomCurrent = feeDenomBreakdown(curBuckets);

  /** Table lists every denom with movement: bank + IBC out (transfer_volume) plus IBC recv (not double-counting IBC out). */
  const transferByDenom = transferVolumeTableByDenom(transferTableBuckets);
  const bankCreditsByDenom = bankCreditsVolumeTableByDenom(transferTableBuckets);
  const feePaidByDenomPrevious = Object.fromEntries(feeDenomBreakdown(prevBuckets));
  const transferSums = aggregateDenomSeries(curBuckets, SERIES.TRANSFER_VOLUME);
  const ibcInSums = aggregateDenomSeries(curBuckets, SERIES.IBC_TRANSFER_AMOUNT_IN);
  const ibcOutSums = aggregateDenomSeries(curBuckets, SERIES.IBC_TRANSFER_AMOUNT_OUT);

  /** Denoms with non-zero TV + IBC recv in range (matches table), sorted by combined total for legend order. */
  const transferDenomsSorted = [...new Set([...transferSums.keys(), ...ibcInSums.keys()])]
    .map((d) => ({
      d,
      total: BigInt(transferSums.get(d) ?? "0") + BigInt(ibcInSums.get(d) ?? "0"),
    }))
    .filter((x) => x.total > BigInt(0))
    .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0))
    .map((x) => x.d);

  const transferVolumeSeries = transferDenomsSorted.map((denom) => ({
    denom,
    data: seriesTransferVolumePlusIbcRecv(curBuckets, denom),
  }));

  const bankCreditsSums = aggregateDenomSeries(curBuckets, SERIES.BANK_CREDITS_VOLUME);
  const bankCreditsDenomsSorted = [...bankCreditsSums.entries()]
    .filter(([, v]) => BigInt(v) > BigInt(0))
    .sort((a, b) => (BigInt(b[1]) > BigInt(a[1]) ? 1 : BigInt(b[1]) < BigInt(a[1]) ? -1 : 0))
    .map(([d]) => d);
  const bankCreditsVolumeSeries = bankCreditsDenomsSorted.map((denom) => ({
    denom,
    data: seriesOverTime(curBuckets, SERIES.BANK_CREDITS_VOLUME, denom),
  }));

  const ibcInDenomsSorted = [...ibcInSums.entries()]
    .filter(([, v]) => BigInt(v) > BigInt(0))
    .sort((a, b) => (BigInt(b[1]) > BigInt(a[1]) ? 1 : BigInt(b[1]) < BigInt(a[1]) ? -1 : 0))
    .map(([d]) => d);
  const ibcOutDenomsSorted = [...ibcOutSums.entries()]
    .filter(([, v]) => BigInt(v) > BigInt(0))
    .sort((a, b) => (BigInt(b[1]) > BigInt(a[1]) ? 1 : BigInt(b[1]) < BigInt(a[1]) ? -1 : 0))
    .map(([d]) => d);
  const ibcAmountInSeries = ibcInDenomsSorted.map((denom) => ({
    denom,
    data: seriesOverTime(curBuckets, SERIES.IBC_TRANSFER_AMOUNT_IN, denom),
  }));
  const ibcAmountOutSeries = ibcOutDenomsSorted.map((denom) => ({
    denom,
    data: seriesOverTime(curBuckets, SERIES.IBC_TRANSFER_AMOUNT_OUT, denom),
  }));

  return {
    granularity,
    range: { from: fromDay, to: toDay },
    comparisonWindow,
    kpis: {
      txSuccess: {
        current: txSuccessCur.toString(),
        previous: txSuccessPrev.toString(),
        pctChange: pctChange(txSuccessCur, txSuccessPrev),
      },
      /** Failed inclusions (ABCI code ≠ 0); consume gas, and pay fees when they failed after the ante handler. */
      txFailed: {
        current: txFailedCur.toString(),
        previous: txFailedPrev.toString(),
        pctChange: pctChange(txFailedCur, txFailedPrev),
      },
      /** Success rate % = tx_success / (tx_success + tx_failed); null when no aligned txs. */
      successRatePct: {
        current: successRatePct(txSuccessCur, txFailedCur),
        previous: successRatePct(txSuccessPrev, txFailedPrev),
      },
      gasUsed: {
        current: gasCur.toString(),
        previous: gasPrev.toString(),
        pctChange: pctChange(gasCur, gasPrev),
      },
      /** ABCI gas_wanted (requested) total; pairs with gasUsed for efficiency. */
      gasWanted: {
        current: gasWantedCur.toString(),
        previous: gasWantedPrev.toString(),
        pctChange: pctChange(gasWantedCur, gasWantedPrev),
      },
      /** Gas efficiency % = gas_used / gas_wanted; null when no gas was requested. */
      gasEfficiencyPct: {
        current: gasEfficiencyPct(gasCur, gasWantedCur),
        previous: gasEfficiencyPct(gasPrev, gasWantedPrev),
      },
      /** Per-block consensus max_gas total; denominator for block-space utilization. */
      blockGasLimit: {
        current: blockGasLimitCur.toString(),
        previous: blockGasLimitPrev.toString(),
        pctChange: pctChange(blockGasLimitCur, blockGasLimitPrev),
      },
      /** Block-space utilization % = gas_used / block_gas_limit; null when no limit recorded. */
      blockGasUtilizationPct: {
        current: blockGasUtilizationPct(gasCur, blockGasLimitCur),
        previous: blockGasUtilizationPct(gasPrev, blockGasLimitPrev),
      },
      /** Sum of MsgTransfer messages (`ibc_transfer_out_count`), not token amounts. */
      ibcOutboundMsgCount: {
        current: ibcOutCur.toString(),
        previous: ibcOutPrev.toString(),
        pctChange: pctChange(ibcOutCur, ibcOutPrev),
      },
      /** Display inbound recv headline (`ibc_transfer_flow_in` preferred; else `ibc_transfer_in_count`). */
      ibcInboundRecvFlowCount: {
        current: ibcInCur.toString(),
        previous: ibcInPrev.toString(),
        pctChange: pctChange(ibcInCur, ibcInPrev),
      },
      feesPaidAllDenoms: {
        current: feeCur.toString(),
        previous: feePrev.toString(),
        pctChange: pctChange(feeCur, feePrev),
      },
      /** Paid fee total in uBLD minimal units (human = BLD). Other fee denoms in feePaidByDenom. */
      feePaidUbld: {
        current: feeUbldCur.toString(),
        previous: feeUbldPrev.toString(),
        pctChange: pctChange(feeUbldCur, feeUbldPrev),
      },
      /** Staking & governance message counts (successful txs). */
      stakingDelegations: countKpi(SERIES.STAKING_DELEGATIONS),
      stakingUndelegations: countKpi(SERIES.STAKING_UNDELEGATIONS),
      stakingRedelegations: countKpi(SERIES.STAKING_REDELEGATIONS),
      govVotes: countKpi(SERIES.GOV_VOTES),
      govProposals: countKpi(SERIES.GOV_PROPOSALS),
    },
    series: {
      txTotal,
      /** Failed inclusions per bucket (ABCI code ≠ 0); pair with txTotal for the success-rate trend. */
      txFailed: txFailedOverTime,
      /** Outbound MsgTransfer msgs + inbound recv-flow headline counts per bucket (not amounts). */
      ibcCombinedCounts: ibcMsgCombined,
      ibcOutboundMsgs: ibcOutSeries,
      ibcInboundRecvFlows: ibcInSeries,
      /** Raw per-bucket gas (ABCI gas_used / gas_wanted) + consensus block gas limit for util/efficiency trends. */
      gasUsed: gasUsedOverTime,
      gasWanted: gasWantedOverTime,
      blockGasLimit: blockGasLimitOverTime,
      /** Per-bucket staking & governance message counts (successful txs). */
      stakingGov: stakingGovOverTime,
      transferVolumeSeries,
      /** Native minimal units from `coin_received` to non-module receivers (`bank_credits_volume`). */
      bankCreditsVolumeSeries,
      /** Native minimal units from IBC recv events (`ibc_transfer_amount_in`). */
      ibcAmountInSeries,
      /** Native minimal units from decoded MsgTransfer (`ibc_transfer_amount_out`). */
      ibcAmountOutSeries,
    },
    transferVolumeByDenom: transferByDenom,
    bankCreditsVolumeByDenom: bankCreditsByDenom,
    feePaidByDenom: Object.fromEntries(feeByDenomCurrent),
    feePaidByDenomPrevious,
    /** SwingSet/Zoe smart-wallet offer activity (intent), with distinct-wallet participation. */
    offers: { ...offersSection, participants: offerParticipants },
    indexer: await getIndexerStatus(),
    pricingInputs,
    questionsInputs,
    ...(usedDailyFallbackForHourView ? { usedDailyFallbackForHourView: true as const } : {}),
  };
}

/**
 * day → denom → summed value across `series` (e.g. transfer_volume + ibc_transfer_amount_in), zero
 * entries dropped. Input must be day-keyed (use `transferTableBuckets`, not chart buckets).
 */
export function dayDenomAmounts(
  bucketMap: Map<string, Map<string, Map<string, bigint>>>,
  series: readonly string[]
): DayDenomAmounts {
  const out: DayDenomAmounts = new Map();
  for (const [day, sm] of bucketMap) {
    const m = new Map<string, bigint>();
    for (const s of series) {
      const dm = sm.get(s);
      if (!dm) continue;
      for (const [denom, v] of dm) {
        if (v > BigInt(0)) m.set(denom, (m.get(denom) ?? BigInt(0)) + v);
      }
    }
    if (m.size > 0) out.set(day, m);
  }
  return out;
}

function aggregateDenomSeries(
  bucketMap: Map<string, Map<string, Map<string, bigint>>>,
  series: string
): Map<string, string> {
  const sums = new Map<string, bigint>();
  for (const sm of bucketMap.values()) {
    const dm = sm.get(series);
    if (!dm) continue;
    for (const [dim, v] of dm) {
      sums.set(dim, (sums.get(dim) ?? BigInt(0)) + v);
    }
  }
  return new Map([...sums.entries()].map(([k, v]) => [k, v.toString()]));
}

function feeDenomBreakdown(
  bucketMap: Map<string, Map<string, Map<string, bigint>>>
): Map<string, string> {
  return aggregateDenomSeries(bucketMap, SERIES.FEE_PAID);
}

/**
 * Range totals for the gross in-tx column of the value-handled denom table: sums `transfer_volume` (MsgSend, MsgMultiSend,
 * IBC MsgTransfer) and `ibc_transfer_amount_in` per denom. IBC outbound amounts are included only in
 * `transfer_volume` — we do **not** add `ibc_transfer_amount_out` (would duplicate MsgTransfer amounts).
 */
export function transferVolumeTableByDenom(
  bucketMap: Map<string, Map<string, Map<string, bigint>>>
): Record<string, string> {
  const tv = aggregateDenomSeries(bucketMap, SERIES.TRANSFER_VOLUME);
  const ibcIn = aggregateDenomSeries(bucketMap, SERIES.IBC_TRANSFER_AMOUNT_IN);
  const keys = new Set<string>([...tv.keys(), ...ibcIn.keys()]);
  const out: Record<string, string> = {};
  for (const d of keys) {
    const sum = BigInt(tv.get(d) ?? "0") + BigInt(ibcIn.get(d) ?? "0");
    if (sum > BigInt(0)) out[d] = sum.toString();
  }
  return out;
}

/**
 * Range totals for `bank_credits_volume`: sums successful-tx `coin_received` credits to
 * non-module-account receivers per denom (same indexer definition as `transferVolumeTableByDenom`
 * grain — daily rows for the selected calendar range when used from `transferTableBuckets`).
 */
export function bankCreditsVolumeTableByDenom(
  bucketMap: Map<string, Map<string, Map<string, bigint>>>
): Record<string, string> {
  const bc = aggregateDenomSeries(bucketMap, SERIES.BANK_CREDITS_VOLUME);
  const out: Record<string, string> = {};
  for (const [d, v] of bc) {
    if (BigInt(v) > BigInt(0)) out[d] = v;
  }
  return out;
}
