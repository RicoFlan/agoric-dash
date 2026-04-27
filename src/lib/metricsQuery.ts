import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { dailyMetrics, hourlyMetrics, indexerState } from "@/db/schema";
import { FEE_DENOM_UBLB, SERIES } from "@/lib/semantics";

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

/** Per-bucket sum of several series (same dimension) — e.g. success+failed, or IBC out+in */
function sumSeriesOverTime(
  bucketMap: Map<string, Map<string, Map<string, bigint>>>,
  seriesNames: readonly string[],
  dimension = ""
): { bucket: string; value: string }[] {
  const keys = [...bucketMap.keys()].sort();
  return keys.map((bucket) => {
    let t = BigInt(0);
    for (const s of seriesNames) {
      t += bucketMap.get(bucket)?.get(s)?.get(dimension) ?? BigInt(0);
    }
    return { bucket, value: t.toString() };
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
  const toMs = new Date(toDay + "T23:59:59Z").getTime();
  const windowDays = Math.max(1, Math.round((toMs - fromMs) / msPerDay) + 1);
  const prevToMs = fromMs - msPerDay;
  const prevFromMs = prevToMs - (windowDays - 1) * msPerDay;
  const prevFromDay = new Date(prevFromMs).toISOString().slice(0, 10);
  const prevToDay = new Date(prevToMs).toISOString().slice(0, 10);

  let curBuckets: Map<string, Map<string, Map<string, bigint>>>;
  let prevBuckets: Map<string, Map<string, Map<string, bigint>>>;
  let comparisonWindow: { from: string; to: string };

  if (granularity === "hour") {
    const fromStart = new Date(fromDay + "T00:00:00.000Z");
    const toEnd = new Date(toDay + "T23:00:00.000Z");
    const nHours = (toEnd.getTime() - fromStart.getTime()) / 3_600_000 + 1;
    const prevTo = new Date(fromStart.getTime() - 3_600_000);
    const prevFrom = new Date(fromStart.getTime() - nHours * 3_600_000);
    const [curH, prevH] = await Promise.all([
      fetchHourlyRange(fromStart, toEnd),
      fetchHourlyRange(prevFrom, prevTo),
    ]);
    curBuckets = aggregateFlatRows(mapHourlyDbToFlat(curH));
    prevBuckets = aggregateFlatRows(mapHourlyDbToFlat(prevH));
    comparisonWindow = { from: prevFrom.toISOString(), to: prevTo.toISOString() };
  } else {
    const [currentRows, prevRows] = await Promise.all([
      fetchMetricsRange(fromDay, toDay),
      fetchMetricsRange(prevFromDay, prevToDay),
    ]);
    const g = granularity;
    const curFlat = dailyRowsToFlat(currentRows, g);
    const prevFlat = dailyRowsToFlat(prevRows, g);
    curBuckets = aggregateFlatRows(curFlat);
    prevBuckets = aggregateFlatRows(prevFlat);
    comparisonWindow = { from: prevFromDay, to: prevToDay };
  }

  const txSuccessCur = sumSeries(curBuckets, SERIES.TX_SUCCESS);
  const txSuccessPrev = sumSeries(prevBuckets, SERIES.TX_SUCCESS);

  const gasCur = sumSeries(curBuckets, SERIES.GAS_USED);
  const gasPrev = sumSeries(prevBuckets, SERIES.GAS_USED);

  const ibcOutCur = sumSeries(curBuckets, SERIES.IBC_TRANSFER_OUT_COUNT);
  const ibcOutPrev = sumSeries(prevBuckets, SERIES.IBC_TRANSFER_OUT_COUNT);

  const ibcInCur = sumSeries(curBuckets, SERIES.IBC_TRANSFER_IN_COUNT);
  const ibcInPrev = sumSeries(prevBuckets, SERIES.IBC_TRANSFER_IN_COUNT);

  /** Sum fees across all denoms (native units per denom kept separate in breakdown) */
  function sumAllFees(m: Map<string, Map<string, Map<string, bigint>>>) {
    let t = BigInt(0);
    const sm = aggregateDenomSeries(m, SERIES.FEE_PAID);
    for (const v of sm.values()) t += BigInt(v);
    return t;
  }

  const feeCur = sumAllFees(curBuckets);
  const feePrev = sumAllFees(prevBuckets);
  const feeUbldCur = sumSeries(curBuckets, SERIES.FEE_PAID, FEE_DENOM_UBLB);
  const feeUbldPrev = sumSeries(prevBuckets, SERIES.FEE_PAID, FEE_DENOM_UBLB);

  const txTotal = sumSeriesOverTime(curBuckets, [SERIES.TX_SUCCESS, SERIES.TX_FAILED]);
  const ibcMsgCombined = sumSeriesOverTime(curBuckets, [
    SERIES.IBC_TRANSFER_OUT_COUNT,
    SERIES.IBC_TRANSFER_IN_COUNT,
  ]);
  const ibcOutSeries = seriesOverTime(curBuckets, SERIES.IBC_TRANSFER_OUT_COUNT);
  const ibcInSeries = seriesOverTime(curBuckets, SERIES.IBC_TRANSFER_IN_COUNT);

  const feeByDenomCurrent = feeDenomBreakdown(curBuckets);

  const composition = compositionFromBuckets(curBuckets, SERIES.MSG_TYPE);

  const transferByDenom = denomBreakdown(curBuckets, SERIES.TRANSFER_VOLUME);
  const feePaidByDenomPrevious = Object.fromEntries(feeDenomBreakdown(prevBuckets));
  const transferSums = aggregateDenomSeries(curBuckets, SERIES.TRANSFER_VOLUME);
  const ibcInSums = aggregateDenomSeries(curBuckets, SERIES.IBC_TRANSFER_AMOUNT_IN);
  const ibcOutSums = aggregateDenomSeries(curBuckets, SERIES.IBC_TRANSFER_AMOUNT_OUT);

  const transferTops = topNByVolume(transferSums, 2);
  const inTops = topNByVolume(ibcInSums, 1);
  const outTops = topNByVolume(ibcOutSums, 1);

  let largestTransfer: { denom: string; amount: string } | null = null;
  for (const [d, a] of Object.entries(transferByDenom)) {
    if (!a) continue;
    const b = BigInt(a);
    if (b === 0n) continue;
    if (!largestTransfer || b > BigInt(largestTransfer.amount)) {
      largestTransfer = { denom: d, amount: a };
    }
  }

  const transfer1Denom = transferTops[0] ?? null;
  const transfer2Denom = transferTops[1] ?? null;
  const transferValueTop1 =
    transfer1Denom != null
      ? { denom: transfer1Denom, data: seriesOverTime(curBuckets, SERIES.TRANSFER_VOLUME, transfer1Denom) }
      : { denom: "" as const, data: [] as { bucket: string; value: string }[] };
  const transferValueTop2: { denom: string; data: { bucket: string; value: string }[] } | null =
    transfer2Denom != null
      ? { denom: transfer2Denom, data: seriesOverTime(curBuckets, SERIES.TRANSFER_VOLUME, transfer2Denom) }
      : null;

  const inDenom = inTops[0] ?? null;
  const outDenom = outTops[0] ?? null;
  const ibcValueIn =
    inDenom != null
      ? { denom: inDenom, data: seriesOverTime(curBuckets, SERIES.IBC_TRANSFER_AMOUNT_IN, inDenom) }
      : { denom: "" as const, data: [] as { bucket: string; value: string }[] };
  const ibcValueOut: { denom: string; data: { bucket: string; value: string }[] } | null =
    outDenom != null
      ? { denom: outDenom, data: seriesOverTime(curBuckets, SERIES.IBC_TRANSFER_AMOUNT_OUT, outDenom) }
      : null;

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
      gasUsed: {
        current: gasCur.toString(),
        previous: gasPrev.toString(),
        pctChange: pctChange(gasCur, gasPrev),
      },
      ibcTransferOutCount: {
        current: ibcOutCur.toString(),
        previous: ibcOutPrev.toString(),
        pctChange: pctChange(ibcOutCur, ibcOutPrev),
      },
      ibcTransferInCount: {
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
    },
    largestTransfer,
    series: {
      txTotal,
      ibcMsgCombined,
      ibcTransferOut: ibcOutSeries,
      ibcTransferIn: ibcInSeries,
      transferValueTop1,
      transferValueTop2,
      ibcValueIn,
      ibcValueOut,
    },
    composition,
    transferVolumeByDenom: transferByDenom,
    feePaidByDenom: Object.fromEntries(feeByDenomCurrent),
    feePaidByDenomPrevious,
    indexer: await getIndexerStatus(),
  };
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

/** Top N denoms by aggregate on-chain amount (string bigint), descending. */
function topNByVolume(sums: Map<string, string>, n: number): string[] {
  return [...sums.entries()]
    .filter(([, v]) => BigInt(v) > BigInt(0))
    .sort((a, b) => (BigInt(b[1]) > BigInt(a[1]) ? 1 : BigInt(b[1]) < BigInt(a[1]) ? -1 : 0))
    .slice(0, n)
    .map(([d]) => d);
}

function denomBreakdown(
  bucketMap: Map<string, Map<string, Map<string, bigint>>>,
  series: string
): Record<string, string> {
  return Object.fromEntries(aggregateDenomSeries(bucketMap, series));
}

function compositionFromBuckets(
  bucketMap: Map<string, Map<string, Map<string, bigint>>>,
  series: string
): { typeUrl: string; count: string }[] {
  const totals = new Map<string, bigint>();
  for (const sm of bucketMap.values()) {
    const dm = sm.get(series);
    if (!dm) continue;
    for (const [msgType, v] of dm) {
      totals.set(msgType, (totals.get(msgType) ?? BigInt(0)) + v);
    }
  }
  return [...totals.entries()]
    .sort((a, b) => (b[1] > a[1] ? 1 : -1))
    .map(([typeUrl, count]) => ({ typeUrl, count: count.toString() }));
}
