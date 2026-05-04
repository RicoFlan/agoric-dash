"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChartChunkFallback } from "@/components/dashboard/ChartChunkFallback";
import { atomicToFloat, atomicToHumanString } from "@/lib/amountFormat";
import { listRow, valueToChartNumber } from "@/lib/displayFormat";
import { chartTheme } from "@/lib/chartTheme";
import type { EnrichedDisplay } from "@/lib/metricsDisplayTypes";
import { sortGrossMovementRows, type GrossMovementRow } from "@/lib/grossTableUsdSort";
import { dashboardSectionIds } from "@/lib/dashboardNav";
import { filledDistinctAccountsPerDay } from "@/lib/filledDistinctAccountsSeries";
import { FEE_DENOM_UBLB, INDEXED_HISTORY_FROM_DAY, METHODOLOGY_BLURB } from "@/lib/semantics";

const TransferVolumeLineChart = dynamic(
  () => import("@/components/dashboard/charts/TransferVolumeLineChart"),
  {
    loading: () => <ChartChunkFallback title="Gross in-tx movement" />,
    ssr: false,
  }
);

const IbcAmountFlowsLineChart = dynamic(
  () => import("@/components/dashboard/charts/IbcAmountFlowsLineChart"),
  {
    loading: () => <ChartChunkFallback title="IBC amount flows" />,
    ssr: false,
  }
);

const AllTxVsIbcLineChart = dynamic(
  () => import("@/components/dashboard/charts/AllTxVsIbcLineChart"),
  {
    loading: () => <ChartChunkFallback title="Transactions vs IBC" />,
    ssr: false,
  }
);

const IbcTrafficLineChart = dynamic(
  () => import("@/components/dashboard/charts/IbcTrafficLineChart"),
  {
    loading: () => <ChartChunkFallback title="IBC traffic" />,
    ssr: false,
  }
);

const DistinctAccountsLineChart = dynamic(
  () => import("@/components/dashboard/charts/DistinctAccountsLineChart"),
  {
    loading: () => <ChartChunkFallback title="Distinct account addresses" />,
    ssr: false,
  }
);

/** Recharts scales can throw or invariant-fail on NaN/Inf domain — scrub plot points. */
function finiteN(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

type Granularity = "hour" | "day" | "week";

interface MetricsPayload {
  granularity?: Granularity;
  display?: EnrichedDisplay;
  range: { from: string; to: string };
  comparisonWindow: { from: string; to: string };
  kpis: {
    txSuccess: { current: string; previous: string; pctChange: number | null };
    gasUsed: { current: string; previous: string; pctChange: number | null };
    ibcTransferOutCount: {
      current: string;
      previous: string;
      pctChange: number | null;
    };
    ibcTransferInCount: {
      current: string;
      previous: string;
      pctChange: number | null;
    };
    feesPaidAllDenoms: {
      current: string;
      previous: string;
      pctChange: number | null;
    };
    feePaidUbld: { current: string; previous: string; pctChange: number | null };
  };
  series: {
    txTotal: { bucket: string; value: string }[];
    ibcMsgCombined: { bucket: string; value: string }[];
    ibcTransferOut: { bucket: string; value: string }[];
    ibcTransferIn: { bucket: string; value: string }[];
    transferVolumeSeries: { denom: string; data: { bucket: string; value: string }[] }[];
    ibcAmountInSeries: { denom: string; data: { bucket: string; value: string }[] }[];
    ibcAmountOutSeries: { denom: string; data: { bucket: string; value: string }[] }[];
  };
  transferVolumeByDenom: Record<string, string>;
  transferVolumeUsdByDenom: Record<string, string | null>;
  transferVolumeUsdTotal: string | null;
  usdPricingMeta: {
    source: "coingecko";
    spotFetchedAt: string | null;
    partialOrStale: boolean;
  };
  feePaidByDenom: Record<string, string>;
  feePaidByDenomPrevious: Record<string, string>;
  indexer: { lastIndexedHeight: string | null; updatedAt: string | null };
  participation?: {
    distinctSigners: string;
    distinctFeePayers: string;
    singleDayInRange: string;
    multiDayInRange: string;
    distinctUnionPerDay: { day: string; count: string }[];
  };
  concentration?: {
    top10AddressShareGrossUsd: string | null;
  };
  /** First day included in indexed DB rollups (UTC); requests earlier than this are clamped. */
  indexedHistoryFromDay?: string;
}

/** UTC calendar date YYYY-MM-DD, shifted by whole days from today UTC. */
function utcCalendarDate(shiftDaysFromToday: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + shiftDaysFromToday);
  return d.toISOString().slice(0, 10);
}

/** Align picker/API range with indexed history (same floor as default INDEXER_START_DATE). */
function clampDayNotBeforeIndexed(day: string): string {
  const d = day.slice(0, 10);
  return d < INDEXED_HISTORY_FROM_DAY ? INDEXED_HISTORY_FROM_DAY : d;
}

const QUICK_RANGE_BTN =
  "rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs font-medium text-[var(--text)] transition-colors hover:bg-[var(--color-bg-secondary)]";

const QUICK_RANGE_BTN_ACTIVE =
  "border-[var(--accent)] bg-[var(--color-bg-secondary)] shadow-sm ring-1 ring-[var(--accent)]/25";

function activeQuickPreset(
  from: string,
  to: string,
  g: Granularity
): "24h" | "week" | "30" | "90" | null {
  const t0 = utcCalendarDate(0);
  if (from === utcCalendarDate(-1) && to === t0 && g === "hour") return "24h";
  if (from === utcCalendarDate(-6) && to === t0 && g === "day") return "week";
  if (from === utcCalendarDate(-29) && to === t0 && g === "day") return "30";
  if (from === utcCalendarDate(-89) && to === t0 && g === "day") return "90";
  return null;
}

/** docs/style-guide.md §2 — top-level section rails: accent (H2 / 20px) + left rail */
const SECTION_HEADING_CLASS =
  "border-l-2 border-[var(--color-accent)] pl-3 text-xl font-semibold leading-tight tracking-tight text-[var(--color-accent)]";

/** In-card panel title (H3 / 18px): primary + subtle rule under the title (style guide structure) */
const IN_CARD_TITLE_CLASS =
  "mb-2 border-b border-[var(--border)] pb-2 text-lg font-semibold leading-snug text-[var(--color-text-primary)]";

function fmtPct(n: number | null): string {
  if (n === null) return "n/a";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function formatBucketTick(v: string, g: Granularity) {
  if (g === "hour") {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return v;
    return `${(d.getUTCMonth() + 1).toString().padStart(2, "0")}/${d.getUTCDate().toString().padStart(2, "0")} ${d.getUTCHours().toString().padStart(2, "0")}:00 UTC`;
  }
  return v;
}

/** Max time to wait for /api/metrics (Postgres can be slow; dev HMR can stall). */
const METRICS_FETCH_MS = 120_000;

/** Native volume column: fixed 2 fractional digits when decimals are known from denoms.json. */
function formatNativeVolumeRounded(atomic: string, decimals: number | undefined): string | null {
  if (typeof decimals !== "number" || !Number.isFinite(decimals) || decimals < 0) return null;
  const n = atomicToFloat(atomic, decimals);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function Dashboard() {
  /** Default load: last 30 calendar days (daily buckets); custom pickers stay hidden until “Custom Range”. */
  const [from, setFrom] = useState(() => clampDayNotBeforeIndexed(utcCalendarDate(-29)));
  const [to, setTo] = useState(() => utcCalendarDate(0));
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [customRangeOpen, setCustomRangeOpen] = useState(false);
  const [data, setData] = useState<MetricsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  /** Gross table: default = ticker/denom order from API; asc/desc = USD (EST) estimate. */
  const [usdSort, setUsdSort] = useState<"default" | "asc" | "desc">("default");

  /** Latest metrics fetch; `finally` clears `loading` only when this controller is still current. */
  const metricsFlightRef = useRef<AbortController | null>(null);
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent;
      /** Do not abort a visible load — silent would clear `loading` in finally and strand the UI. */
      if (silent && loadingRef.current) return;

      metricsFlightRef.current?.abort();
      const ctrl = new AbortController();
      metricsFlightRef.current = ctrl;
      const tid = setTimeout(() => ctrl.abort(), METRICS_FETCH_MS);

      if (!silent) {
        setLoading(true);
        setErr(null);
      }
      const requestedFrom = from;
      const requestedTo = to;
      try {
        const mRes = await fetch(
          `/api/metrics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&granularity=${granularity}`,
          { signal: ctrl.signal }
        );
        const ct = mRes.headers.get("content-type") ?? "";
        if (!mRes.ok) {
          const j = await mRes.json().catch(() => ({})) as { error?: string };
          const hint =
            typeof j.error === "string"
              ? j.error
              : ct.includes("application/json")
                ? mRes.statusText
                : `Server error (${mRes.status}). If you use \`next dev\`, try \`rm -rf .next\` and restart, or \`npm run dev:clean\`.`;
          throw new Error(hint || mRes.statusText);
        }
        if (!ct.includes("application/json")) {
          throw new Error(
            "Unexpected response from /api/metrics (not JSON). Try `rm -rf .next` and restart the dev server."
          );
        }
        const m = (await mRes.json()) as MetricsPayload;
        if (metricsFlightRef.current !== ctrl) return;
        setData(m);
        if (
          m.range?.from &&
          m.range?.to &&
          (m.range.from !== requestedFrom || m.range.to !== requestedTo)
        ) {
          setFrom(m.range.from);
          setTo(m.range.to);
        }
        if (silent) setErr(null);
      } catch (e) {
        if (metricsFlightRef.current !== ctrl) return;
        if (!silent) {
          const aborted = e instanceof DOMException && e.name === "AbortError";
          const msg = aborted
            ? "Loading metrics timed out or was cancelled. Check Postgres, run `npm run dev:clean` if the dev server returns 500."
            : e instanceof Error
              ? e.message
              : "Failed to load metrics";
          setErr(msg);
          setData(null);
        }
      } finally {
        clearTimeout(tid);
        if (!silent && metricsFlightRef.current === ctrl) {
          setLoading(false);
        }
      }
    },
    [from, to, granularity]
  );

  useEffect(() => {
    void load();
    return () => {
      metricsFlightRef.current?.abort();
    };
  }, [load]);

  useEffect(() => {
    setUsdSort("default");
  }, [from, to, granularity]);

  /** Join bucket streams for aligned line charts (handles sparse edges). */
  const chartAllTxVsIbc = useMemo(() => {
    if (!data) return [];
    const tx = data.series?.txTotal ?? [];
    const ibc = data.series?.ibcMsgCombined ?? [];
    const txM = new Map(tx.map((r) => [r.bucket, finiteN(Number(r.value))]));
    const ibcM = new Map(ibc.map((r) => [r.bucket, finiteN(Number(r.value))]));
    const keys = [...new Set([...txM.keys(), ...ibcM.keys()])].sort();
    return keys.map((bucket) => ({
      bucket,
      totalTx: txM.get(bucket) ?? 0,
      ibcMsgs: ibcM.get(bucket) ?? 0,
    }));
  }, [data]);

  const chartIbcTraffic = useMemo(() => {
    if (!data) return [];
    const o = data.series?.ibcTransferOut ?? [];
    const i = data.series?.ibcTransferIn ?? [];
    const outM = new Map(o.map((r) => [r.bucket, finiteN(Number(r.value))]));
    const inM = new Map(i.map((r) => [r.bucket, finiteN(Number(r.value))]));
    const keys = [...new Set([...outM.keys(), ...inM.keys()])].sort();
    return keys.map((bucket) => ({
      bucket,
      out: outM.get(bucket) ?? 0,
      recv: inM.get(bucket) ?? 0,
    }));
  }, [data]);

  const chartTransferValue = useMemo(() => {
    if (!data) {
      return {
        rows: [] as Array<{ bucket: string } & Record<string, number>>,
        series: [] as { chartKey: string; denom: string; displaySymbol: string | null }[],
      };
    }
    const tvs = data.series?.transferVolumeSeries ?? [];
    if (tvs.length === 0) {
      return {
        rows: [] as Array<{ bucket: string } & Record<string, number>>,
        series: [] as { chartKey: string; denom: string; displaySymbol: string | null }[],
      };
    }
    const disp = data.display;
    const seriesMeta = tvs.map((s, i) => ({
      chartKey: `v${i}`,
      denom: s.denom,
      displaySymbol: disp?.metas[s.denom]?.displaySymbol ?? null,
    }));
    const maps = tvs.map((s) =>
      new Map(
        (s.data ?? []).map((r) => [
          r.bucket,
          finiteN(valueToChartNumber(r.value, s.denom, disp)),
        ])
      )
    );
    const bucketSet = new Set<string>();
    for (const m of maps) for (const k of m.keys()) bucketSet.add(k);
    const keys = [...bucketSet].sort();
    const rows = keys.map((bucket) => {
      const row = { bucket } as { bucket: string } & Record<string, number>;
      for (let i = 0; i < seriesMeta.length; i++) {
        row[seriesMeta[i].chartKey] = finiteN(maps[i].get(bucket) ?? 0);
      }
      return row;
    });
    return { rows, series: seriesMeta };
  }, [data]);

  const grossInTxRows = useMemo((): GrossMovementRow[] => {
    const tv = data?.transferVolumeByDenom;
    if (!tv) return [];
    const disp = data.display;
    const mapped: GrossMovementRow[] = Object.entries(tv).map(([denom, amt]) => {
      const r = disp
        ? listRow(amt, denom, disp)
        : { amountHuman: amt, symbol: "", rawDenom: denom };
      const ticker = r.symbol || "—";
      const usd = data.transferVolumeUsdByDenom[denom] ?? null;
      const dec = disp?.metas[denom]?.decimals;
      const rounded = formatNativeVolumeRounded(amt, dec);
      const grossDisplay = rounded ?? r.amountHuman;
      return {
        key: denom,
        denom,
        ticker,
        grossDisplay,
        grossUnknown: !r.symbol,
        usd,
      };
    });
    return sortGrossMovementRows(mapped, usdSort);
  }, [data, usdSort]);

  const chartIbcValueAmounts = useMemo(() => {
    if (!data) {
      return {
        rows: [] as Array<{ bucket: string } & Record<string, number>>,
        series: [] as {
          chartKey: string;
          denom: string;
          displaySymbol: string | null;
          direction: "in" | "out";
        }[],
      };
    }
    const ins = data.series?.ibcAmountInSeries ?? [];
    const outs = data.series?.ibcAmountOutSeries ?? [];
    if (ins.length === 0 && outs.length === 0) {
      return {
        rows: [] as Array<{ bucket: string } & Record<string, number>>,
        series: [] as {
          chartKey: string;
          denom: string;
          displaySymbol: string | null;
          direction: "in" | "out";
        }[],
      };
    }
    const disp = data.display;
    const seriesMeta: {
      chartKey: string;
      denom: string;
      displaySymbol: string | null;
      direction: "in" | "out";
    }[] = [];
    for (let i = 0; i < ins.length; i++) {
      const s = ins[i];
      seriesMeta.push({
        chartKey: `in${i}`,
        denom: s.denom,
        displaySymbol: disp?.metas[s.denom]?.displaySymbol ?? null,
        direction: "in",
      });
    }
    for (let i = 0; i < outs.length; i++) {
      const s = outs[i];
      seriesMeta.push({
        chartKey: `out${i}`,
        denom: s.denom,
        displaySymbol: disp?.metas[s.denom]?.displaySymbol ?? null,
        direction: "out",
      });
    }
    const maps = [
      ...ins.map((s) =>
        new Map(
          (s.data ?? []).map((r) => [
            r.bucket,
            finiteN(valueToChartNumber(r.value, s.denom, disp)),
          ])
        )
      ),
      ...outs.map((s) =>
        new Map(
          (s.data ?? []).map((r) => [
            r.bucket,
            finiteN(valueToChartNumber(r.value, s.denom, disp)),
          ])
        )
      ),
    ];
    const bucketSet = new Set<string>();
    for (const m of maps) for (const k of m.keys()) bucketSet.add(k);
    const keys = [...bucketSet].sort();
    const rows = keys.map((bucket) => {
      const row = { bucket } as { bucket: string } & Record<string, number>;
      for (let i = 0; i < seriesMeta.length; i++) {
        row[seriesMeta[i].chartKey] = finiteN(maps[i].get(bucket) ?? 0);
      }
      return row;
    });
    return { rows, series: seriesMeta };
  }, [data]);

  const chartDistinctAccountsRows = useMemo(() => {
    const sparse = data?.participation?.distinctUnionPerDay;
    if (!sparse) return [];
    return filledDistinctAccountsPerDay(from, to, sparse);
  }, [from, to, data?.participation?.distinctUnionPerDay]);

  const distinctAccountsTimeAxis = useMemo(() => {
    const n = chartDistinctAccountsRows.length;
    const dense = n > 31;
    return {
      dataKey: "bucket" as const,
      tick: { fill: chartTheme.axisTick, fontSize: dense ? 9 : 11 },
      ...(dense
        ? {
            height: 58,
            angle: -32,
            textAnchor: "end" as const,
            interval: "preserveStartEnd" as const,
            minTickGap: 4,
          }
        : {}),
      tickFormatter: (v: string) => {
        const d = new Date(`${v.slice(0, 10)}T12:00:00.000Z`);
        if (Number.isNaN(d.getTime())) return v;
        return `${(d.getUTCMonth() + 1).toString().padStart(2, "0")}/${d.getUTCDate().toString().padStart(2, "0")}`;
      },
    };
  }, [chartDistinctAccountsRows]);

  const timeAxis = useMemo(() => {
    const g = granularity;
    if (g === "hour") {
      return {
        dataKey: "bucket" as const,
        tick: { fill: chartTheme.axisTick, fontSize: 9 },
        height: 58,
        angle: -32,
        textAnchor: "end" as const,
        interval: "preserveStartEnd" as const,
        minTickGap: 6,
        tickFormatter: (v: string) => formatBucketTick(v, g),
      };
    }
    return {
      dataKey: "bucket" as const,
      tick: { fill: chartTheme.axisTick, fontSize: 11 },
      tickFormatter: (v: string) => formatBucketTick(v, g),
    };
  }, [granularity]);

  return (
    <div className="space-y-10">
      {data?.indexer?.lastIndexedHeight && (
        <p className="text-xs text-[var(--color-text-secondary)]">
          Last indexed block height:{" "}
          <code className="text-[var(--accent)]">{data.indexer.lastIndexedHeight}</code>
          {data.indexer.updatedAt && (
            <span className="ml-2">
              (indexer updated {new Date(data.indexer.updatedAt).toLocaleString()})
            </span>
          )}
        </p>
      )}

      <section
        id={dashboardSectionIds.filters}
        className="scroll-mt-6 flex flex-wrap items-end gap-4 rounded-lg border border-[var(--border)] bg-[var(--color-bg-control)] p-5 shadow-[var(--shadow-card)]"
      >
        <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-3 border-b border-[var(--border)]/60 pb-4">
          <label className="flex shrink-0 flex-row items-center gap-2 text-sm leading-[1.4]">
            <span className="whitespace-nowrap text-sm font-medium text-[var(--color-text-secondary)]">
              Granularity
            </span>
            <select
              value={granularity}
              onChange={(e) => setGranularity(e.target.value as Granularity)}
              className="min-w-[10.5rem] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[var(--text)] transition-colors hover:bg-[var(--color-bg-secondary)]"
            >
              <option value="hour">Hour (UTC)</option>
              <option value="day">Day</option>
              <option value="week">Week (UTC Monday)</option>
            </select>
          </label>
          <div className="flex min-h-0 min-w-0 flex-1 flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
              Quick range
            </span>
            <button
              type="button"
              className={`${QUICK_RANGE_BTN} ${!customRangeOpen && activeQuickPreset(from, to, granularity) === "24h" ? QUICK_RANGE_BTN_ACTIVE : ""}`}
              title="UTC: From = yesterday, To = today; hourly buckets."
              onClick={() => {
                setCustomRangeOpen(false);
                setFrom(clampDayNotBeforeIndexed(utcCalendarDate(-1)));
                setTo(utcCalendarDate(0));
                setGranularity("hour");
              }}
            >
              Last 24 hours
            </button>
            <button
              type="button"
              className={`${QUICK_RANGE_BTN} ${!customRangeOpen && activeQuickPreset(from, to, granularity) === "week" ? QUICK_RANGE_BTN_ACTIVE : ""}`}
              title="UTC: last 7 calendar days inclusive, daily buckets."
              onClick={() => {
                setCustomRangeOpen(false);
                setFrom(clampDayNotBeforeIndexed(utcCalendarDate(-6)));
                setTo(utcCalendarDate(0));
                setGranularity("day");
              }}
            >
              Last Week
            </button>
            <button
              type="button"
              className={`${QUICK_RANGE_BTN} ${!customRangeOpen && activeQuickPreset(from, to, granularity) === "30" ? QUICK_RANGE_BTN_ACTIVE : ""}`}
              title="UTC: last 30 calendar days inclusive, daily buckets."
              onClick={() => {
                setCustomRangeOpen(false);
                setFrom(clampDayNotBeforeIndexed(utcCalendarDate(-29)));
                setTo(utcCalendarDate(0));
                setGranularity("day");
              }}
            >
              Last 30 Days
            </button>
            <button
              type="button"
              className={`${QUICK_RANGE_BTN} ${!customRangeOpen && activeQuickPreset(from, to, granularity) === "90" ? QUICK_RANGE_BTN_ACTIVE : ""}`}
              title="UTC: last 90 calendar days inclusive, daily buckets."
              onClick={() => {
                setCustomRangeOpen(false);
                setFrom(clampDayNotBeforeIndexed(utcCalendarDate(-89)));
                setTo(utcCalendarDate(0));
                setGranularity("day");
              }}
            >
              Last 90 Days
            </button>
            <button
              type="button"
              className={`${QUICK_RANGE_BTN} ${customRangeOpen ? QUICK_RANGE_BTN_ACTIVE : ""}`}
              title="Show From / To dates; changes apply automatically."
              onClick={() => setCustomRangeOpen(true)}
            >
              Custom Range
            </button>
          </div>
        </div>

        {customRangeOpen && (
          <div className="flex w-full flex-wrap items-center gap-4 border-b border-[var(--border)]/60 pb-4">
            <label className="flex flex-row items-center gap-2 text-sm leading-[1.4]">
              <span className="whitespace-nowrap text-sm font-medium text-[var(--color-text-secondary)]">
                From
              </span>
              <input
                type="date"
                min={INDEXED_HISTORY_FROM_DAY}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[var(--text)] transition-colors hover:bg-[var(--color-bg-secondary)]"
              />
            </label>
            <label className="flex flex-row items-center gap-2 text-sm leading-[1.4]">
              <span className="whitespace-nowrap text-sm font-medium text-[var(--color-text-secondary)]">
                To
              </span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[var(--text)] transition-colors hover:bg-[var(--color-bg-secondary)]"
              />
            </label>
          </div>
        )}
        <p className="w-full text-xs leading-[1.4] text-[var(--muted)]">
          Indexed rollups and participation metrics start{" "}
          <time dateTime={INDEXED_HISTORY_FROM_DAY}>{INDEXED_HISTORY_FROM_DAY}</time> UTC. The API
          clamps <strong className="font-medium text-[var(--color-text-secondary)]">From</strong> to
          that day when needed so results match the indexer window.
        </p>
      </section>

      {err && (
        <div
          className="rounded-md border px-4 py-3 text-sm"
          style={{
            borderColor: "color-mix(in srgb, var(--color-error) 45%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--color-error) 12%, var(--color-bg-primary))",
            color: "var(--color-text-primary)",
          }}
        >
          {err}
          <p className="mt-2 text-xs opacity-90" style={{ color: "var(--color-text-secondary)" }}>
            Start Postgres (<code className="text-[var(--accent)]">docker compose up -d</code>),
            run <code className="text-[var(--accent)]">npm run db:push</code>, then{" "}
            <code className="text-[var(--accent)]">npm run indexer</code>.
          </p>
        </div>
      )}

      {loading && !data && !err && (
        <p className="text-[var(--muted)]">Loading metrics…</p>
      )}

      {data && data.kpis && (
        <>
          <section id={dashboardSectionIds.valueHandled} className="scroll-mt-6 min-w-0 space-y-6">
            <h2 className={SECTION_HEADING_CLASS}>Value handled</h2>
            <div className="w-full min-w-0">
              <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
                <h3 className={IN_CARD_TITLE_CLASS}>Gross in-tx movement by denom (range total)</h3>
                <p className="mb-3 text-xs leading-snug text-[var(--muted)]">
                  Sum of transfer-message legs plus IBC receive per denom for the range (same definition as the line chart below). USD estimates multiply each asset&apos;s{" "}
                  <strong className="font-medium text-[var(--color-text-secondary)]">full-period native total</strong> by{" "}
                  <strong className="font-medium text-[var(--color-text-secondary)]">current CoinGecko spot USD</strong>. That is{" "}
                  <strong className="font-medium text-[var(--color-text-secondary)]">not</strong> a historically accurate mark-to-market over the selected range, but it makes
                  cross-asset sizes easier to compare. Native amounts remain the on-chain record.
                  {data.usdPricingMeta.partialOrStale && (
                    <span> Some USD cells may be empty when the price feed is rate-limited.</span>
                  )}
                  {data.usdPricingMeta.spotFetchedAt && (
                    <span>
                      {" "}
                      Spot snapshot:{" "}
                      <time dateTime={data.usdPricingMeta.spotFetchedAt}>
                        {new Date(data.usdPricingMeta.spotFetchedAt).toLocaleString()}
                      </time>
                      .
                    </span>
                  )}
                </p>
                <div className="min-w-0 max-w-full overflow-x-auto">
                  <table className="w-full min-w-0 table-fixed border-collapse text-xs sm:text-sm">
                    <colgroup>
                      <col className="w-[10%]" />
                      <col className="w-[20%]" />
                      <col className="w-[20%]" />
                      <col className="w-[50%]" />
                    </colgroup>
                    <thead>
                      <tr className="rounded-t-sm bg-[var(--color-bg-secondary)] text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]/55 sm:text-xs sm:tracking-wider">
                        <th
                          scope="col"
                          className="px-1.5 py-2 text-left align-bottom font-semibold normal-case sm:px-2"
                        >
                          Ticker
                        </th>
                        <th
                          scope="col"
                          className="px-1.5 py-2 text-right align-bottom font-semibold normal-case sm:px-2"
                          title="transfer_volume + IBC recv (gross in-tx movement)"
                        >
                          Gross
                        </th>
                        <th
                          scope="col"
                          aria-sort={
                            usdSort === "default"
                              ? "none"
                              : usdSort === "asc"
                                ? "ascending"
                                : "descending"
                          }
                          className="px-1.5 py-2 text-right align-bottom font-semibold normal-case sm:px-2"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setUsdSort((s) =>
                                s === "default" ? "desc" : s === "desc" ? "asc" : "default"
                              )
                            }
                            className="inline-flex w-full max-w-full items-center justify-end gap-1 rounded px-1 py-0.5 text-[var(--color-accent)] transition-colors hover:bg-[var(--color-bg-primary)]/70 hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
                            aria-label={
                              usdSort === "default"
                                ? "Sort by USD estimate, highest first"
                                : usdSort === "desc"
                                  ? "Sort by USD estimate, lowest first"
                                  : "Clear USD sort (ticker order)"
                            }
                          >
                            <span>USD (EST)</span>
                            <span
                              className="font-mono text-[10px] leading-none text-[var(--color-text-secondary)]"
                              aria-hidden
                            >
                              {usdSort === "desc" ? "▼" : usdSort === "asc" ? "▲" : "⇅"}
                            </span>
                          </button>
                        </th>
                        <th
                          scope="col"
                          className="min-w-0 px-1.5 py-2 text-left align-bottom font-semibold normal-case sm:px-2"
                        >
                          Denom
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {grossInTxRows.map((row) => (
                        <tr
                          key={row.key}
                          className="border-b border-[var(--border)]/50 odd:bg-[var(--color-bg-primary)] even:bg-[var(--color-border)]"
                        >
                          <td className="max-w-0 min-w-0 overflow-x-auto whitespace-nowrap px-1.5 py-2 align-middle font-medium leading-tight text-[var(--text)] sm:px-2">
                            {row.ticker}
                          </td>
                          <td className="max-w-0 min-w-0 overflow-x-auto whitespace-nowrap px-1.5 py-2 text-right font-mono text-xs tabular-nums leading-tight text-[var(--text)] sm:px-2 sm:text-sm">
                            {row.grossUnknown ? (
                              <code className="text-xs text-amber-200/90">{row.grossDisplay}</code>
                            ) : (
                              row.grossDisplay
                            )}
                          </td>
                          <td className="max-w-0 min-w-0 overflow-x-auto whitespace-nowrap px-1.5 py-2 text-right font-mono text-xs tabular-nums leading-tight text-[var(--text)] sm:px-2 sm:text-sm">
                            {row.usd ?? "—"}
                          </td>
                          <td className="max-w-0 min-w-0 overflow-x-auto whitespace-nowrap px-1.5 py-2 align-middle sm:px-2">
                            <code
                              className="block w-max whitespace-nowrap text-left text-[11px] leading-tight text-[var(--muted)] sm:text-xs"
                              title={row.denom}
                            >
                              {row.denom}
                            </code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr
                        className="border-t-2 border-[var(--border)] text-xs font-semibold text-[var(--color-text-primary)] sm:text-sm"
                        aria-label="Totals"
                      >
                        <td className="px-1.5 py-3 text-[var(--color-accent)] sm:px-2">TOTAL</td>
                        <td
                          className="px-1.5 py-3 text-center text-[var(--muted)] sm:px-2"
                          title="Not summed across assets"
                        >
                          —
                        </td>
                        <td className="px-1.5 py-3 text-right font-mono tabular-nums sm:px-2">
                          {data.transferVolumeUsdTotal ?? "—"}
                        </td>
                        <td aria-hidden className="min-w-0 px-1.5 py-3 sm:px-2" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>

            <section className="space-y-8 lg:space-y-10">
              <TransferVolumeLineChart model={chartTransferValue} timeAxis={timeAxis} />
              <IbcAmountFlowsLineChart model={chartIbcValueAmounts} timeAxis={timeAxis} />
            </section>
          </section>

          <section id={dashboardSectionIds.gasFees} className="scroll-mt-6 space-y-4">
            <h2 className={SECTION_HEADING_CLASS}>Gas and fees</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <KpiCard
                title="Gas used"
                subtitle="ABCI / consensus gas units, not a token or BLD"
                current={data.kpis.gasUsed.current}
                previous={data.kpis.gasUsed.previous}
                pct={data.kpis.gasUsed.pctChange}
              />
              <KpiCard
                title="Paid fees (uBLD → BLD)"
                subtitle={`On-chain paid fee total in ${FEE_DENOM_UBLB} (shown as BLD).`}
                current={
                  /^\d+$/.test(data.kpis.feePaidUbld.current)
                    ? `${atomicToHumanString(data.kpis.feePaidUbld.current, 6)} BLD`
                    : "—"
                }
                previous={
                  /^\d+$/.test(data.kpis.feePaidUbld.previous)
                    ? `${atomicToHumanString(data.kpis.feePaidUbld.previous, 6)} BLD`
                    : "—"
                }
                pct={data.kpis.feePaidUbld.pctChange}
              />
            </div>
          </section>

          <section id={dashboardSectionIds.transactionActivity} className="scroll-mt-6 space-y-4">
            <h2 className={SECTION_HEADING_CLASS}>Transaction activity</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <KpiCard
                title="Successful txs"
                current={data.kpis.txSuccess.current}
                previous={data.kpis.txSuccess.previous}
                pct={data.kpis.txSuccess.pctChange}
              />
              <KpiCard
                title="IBC transfers out (msgs)"
                current={data.kpis.ibcTransferOutCount.current}
                previous={data.kpis.ibcTransferOutCount.previous}
                pct={data.kpis.ibcTransferOutCount.pctChange}
              />
              <KpiCard
                title="IBC recv packets (msgs)"
                current={data.kpis.ibcTransferInCount.current}
                previous={data.kpis.ibcTransferInCount.previous}
                pct={data.kpis.ibcTransferInCount.pctChange}
              />
            </div>
          </section>

          <section id={dashboardSectionIds.volumeIbc} className="scroll-mt-6 space-y-3">
            <h2 className={SECTION_HEADING_CLASS}>Volume and IBC (time series)</h2>
            <div className="space-y-8 lg:space-y-10">
              <AllTxVsIbcLineChart data={chartAllTxVsIbc} timeAxis={timeAxis} />
              <IbcTrafficLineChart data={chartIbcTraffic} timeAxis={timeAxis} />
            </div>
          </section>

          {(data.participation || data.concentration) && (
            <section id={dashboardSectionIds.participation} className="scroll-mt-6 space-y-4">
              <h2 className={SECTION_HEADING_CLASS}>Economic participation &amp; concentration</h2>
              <p className="max-w-3xl text-xs leading-snug text-[var(--muted)]">
                Addresses are not end users: bots, vaults, and protocol wallets can inflate counts.
                The top-10 gross share uses USD spot estimates (same caveats as gross movement) on
                sender-side transfer legs only — see methodology.
              </p>
              {data.participation && chartDistinctAccountsRows.length > 0 && (
                <DistinctAccountsLineChart
                  data={chartDistinctAccountsRows}
                  timeAxis={distinctAccountsTimeAxis}
                />
              )}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.participation && (
                  <>
                    <KpiCardLite title="Distinct signers (range)" value={data.participation.distinctSigners} />
                    <KpiCardLite title="Distinct fee payers (range)" value={data.participation.distinctFeePayers} />
                    <KpiCardLite
                      title="Active 1 day only (in range)"
                      subtitle="Calendar days with any signer/fee role"
                      value={data.participation.singleDayInRange}
                    />
                    <KpiCardLite
                      title="Active 2+ days (in range)"
                      subtitle="Returning within the selected window"
                      value={data.participation.multiDayInRange}
                    />
                  </>
                )}
                {data.concentration && (
                  <KpiCardLite
                    title="Top 10 addresses — gross USD share"
                    subtitle="Sender-attributed transfer legs"
                    value={data.concentration.top10AddressShareGrossUsd ?? "—"}
                  />
                )}
              </div>
              {data.participation &&
                data.participation.distinctUnionPerDay &&
                data.participation.distinctUnionPerDay.length > 0 && (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
                    <h3 className={IN_CARD_TITLE_CLASS}>Distinct account addresses per calendar day</h3>
                    <div className="max-h-48 overflow-y-auto">
                      <table className="w-full border-collapse text-xs sm:text-sm">
                        <thead>
                          <tr className="border-b border-[var(--border)] text-left text-[var(--color-accent)]">
                            <th className="py-2 pr-4 font-semibold">Day (UTC)</th>
                            <th className="py-2 font-semibold">Count</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.participation.distinctUnionPerDay.map((r) => (
                            <tr key={r.day} className="border-b border-[var(--border)]/40">
                              <td className="py-1.5 font-mono text-[var(--text)]">{r.day}</td>
                              <td className="py-1.5 font-mono tabular-nums text-[var(--text)]">{r.count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
            </section>
          )}
        </>
      )}

      <footer id={dashboardSectionIds.methodology} className="scroll-mt-6 border-t border-[var(--border)] pt-6">
        <button
          type="button"
          onClick={() => setMethodologyOpen((o) => !o)}
          className="text-sm text-[var(--accent)] hover:underline"
        >
          {methodologyOpen ? "Hide methodology" : "Methodology & caveats"}
        </button>
        {methodologyOpen && (
          <pre className="mt-4 whitespace-pre-wrap rounded border border-[var(--border)] bg-[var(--surface)] p-5 text-xs text-[var(--muted)]">
            {METHODOLOGY_BLURB.trim()}
          </pre>
        )}
      </footer>
    </div>
  );
}

function KpiCard({
  title,
  subtitle,
  current,
  previous,
  pct,
}: {
  title: string;
  subtitle?: string;
  current: string;
  previous: string;
  pct: number | null;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{title}</h3>
      {subtitle && <p className="mt-1 text-xs text-[var(--muted)]">{subtitle}</p>}
      <p className="mt-2 font-mono text-2xl text-[var(--text)]">{current}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Prior window: <span className="font-mono text-[var(--text)]">{previous}</span>
        {" · "}
        <span
          className={
            pct !== null && pct >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-warning)]"
          }
        >
          {fmtPct(pct)}
        </span>
      </p>
    </div>
  );
}

function KpiCardLite({
  title,
  subtitle,
  value,
}: {
  title: string;
  subtitle?: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{title}</h3>
      {subtitle && <p className="mt-1 text-xs text-[var(--muted)]">{subtitle}</p>}
      <p className="mt-2 font-mono text-2xl text-[var(--text)]">{value}</p>
    </div>
  );
}
