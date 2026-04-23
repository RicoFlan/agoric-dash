import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { dailyMetrics, indexerState } from "@/db/schema";
import { SERIES } from "@/lib/semantics";

export type Granularity = "day" | "week";

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

async function fetchMetricsRange(fromDay: string, toDay: string) {
  return db
    .select()
    .from(dailyMetrics)
    .where(and(gte(dailyMetrics.day, fromDay), lte(dailyMetrics.day, toDay)));
}

function bucketByGranularity(
  rows: { day: string; series: string; dimension: string; value: string }[],
  granularity: Granularity
): Map<string, Map<string, Map<string, bigint>>> {
  /** bucket -> series -> dimension -> sum */
  const out = new Map<string, Map<string, Map<string, bigint>>>();
  for (const r of rows) {
    const bucket =
      granularity === "day" ? parseDay(r.day) : mondayBucket(parseDay(r.day));
    if (!out.has(bucket)) out.set(bucket, new Map());
    const sm = out.get(bucket)!;
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

function movingAverage(
  points: { bucket: string; value: string }[],
  window: number
): { bucket: string; ma: string }[] {
  const out: { bucket: string; ma: string }[] = [];
  for (let i = 0; i < points.length; i++) {
    const start = Math.max(0, i - window + 1);
    let s = BigInt(0);
    let n = 0;
    for (let j = start; j <= i; j++) {
      s += BigInt(points[j].value);
      n += 1;
    }
    out.push({
      bucket: points[i].bucket,
      ma: (s / BigInt(n)).toString(),
    });
  }
  return out;
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

  const [currentRows, prevRows] = await Promise.all([
    fetchMetricsRange(fromDay, toDay),
    fetchMetricsRange(prevFromDay, prevToDay),
  ]);

  const curBuckets = bucketByGranularity(currentRows, granularity);
  const prevBuckets = bucketByGranularity(prevRows, granularity);

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

  const txSeries = seriesOverTime(curBuckets, SERIES.TX_SUCCESS);
  const txMa7 = movingAverage(
    txSeries.map((p) => ({ bucket: p.bucket, value: p.value })),
    Math.min(7, txSeries.length || 1)
  );

  const feeByDenomCurrent = feeDenomBreakdown(curBuckets);
  const feeSeriesTopDenom = (() => {
    let top = "";
    let max = BigInt(0);
    for (const [d, v] of feeByDenomCurrent) {
      if (BigInt(v) > max) {
        max = BigInt(v);
        top = d;
      }
    }
    if (!top) return [];
    return seriesOverTime(curBuckets, SERIES.FEE_PAID, top).map((p) => ({
      bucket: p.bucket,
      denom: top,
      value: p.value,
    }));
  })();

  const composition = compositionFromBuckets(curBuckets, SERIES.MSG_TYPE);

  const transferByDenom = denomBreakdown(curBuckets, SERIES.TRANSFER_VOLUME);

  return {
    range: { from: fromDay, to: toDay },
    comparisonWindow: { from: prevFromDay, to: prevToDay },
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
    },
    series: {
      txSuccess: txSeries,
      txSuccessMa7: txMa7,
      feesPaidByTopDenom: feeSeriesTopDenom,
    },
    composition,
    transferVolumeByDenom: transferByDenom,
    feePaidByDenom: Object.fromEntries(feeByDenomCurrent),
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
