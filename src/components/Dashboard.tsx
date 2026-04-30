"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChartChunkFallback } from "@/components/dashboard/ChartChunkFallback";
import { atomicToHumanString } from "@/lib/amountFormat";
import { listRow, valueToChartNumber } from "@/lib/displayFormat";
import { chartTheme } from "@/lib/chartTheme";
import type { EnrichedDisplay } from "@/lib/metricsDisplayTypes";
import { FEE_DENOM_UBLB, METHODOLOGY_BLURB, MESSAGE_ATTRIBUTION } from "@/lib/semantics";

const TransferVolumeLineChart = dynamic(
  () => import("@/components/dashboard/charts/TransferVolumeLineChart"),
  {
    loading: () => <ChartChunkFallback title="In-tx transfer volume" />,
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

const TransactionNatureBarChart = dynamic(
  () => import("@/components/dashboard/charts/TransactionNatureBarChart"),
  {
    loading: () => (
      <ChartChunkFallback title="Transaction nature" className="h-80" />
    ),
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
  largestTransfer: { denom: string; amount: string } | null;
  series: {
    txTotal: { bucket: string; value: string }[];
    ibcMsgCombined: { bucket: string; value: string }[];
    ibcTransferOut: { bucket: string; value: string }[];
    ibcTransferIn: { bucket: string; value: string }[];
    transferVolumeSeries: { denom: string; data: { bucket: string; value: string }[] }[];
    ibcAmountInSeries: { denom: string; data: { bucket: string; value: string }[] }[];
    ibcAmountOutSeries: { denom: string; data: { bucket: string; value: string }[] }[];
  };
  composition: { typeUrl: string; count: string }[];
  transferVolumeByDenom: Record<string, string>;
  feePaidByDenom: Record<string, string>;
  feePaidByDenomPrevious: Record<string, string>;
  indexer: { lastIndexedHeight: string | null; updatedAt: string | null };
}

function defaultDateRange() {
  const to = new Date();
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 30);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

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

export function Dashboard() {
  const defaults = useMemo(() => defaultDateRange(), []);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [granularity, setGranularity] = useState<Granularity>("hour");
  const [data, setData] = useState<MetricsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [methodologyOpen, setMethodologyOpen] = useState(false);

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
    const id = setInterval(() => void load({ silent: true }), 60_000);
    return () => clearInterval(id);
  }, [load]);

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
      const row: { bucket: string } & Record<string, number> = { bucket };
      for (let i = 0; i < seriesMeta.length; i++) {
        row[seriesMeta[i].chartKey] = finiteN(maps[i].get(bucket) ?? 0);
      }
      return row;
    });
    return { rows, series: seriesMeta };
  }, [data]);

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
      const row: { bucket: string } & Record<string, number> = { bucket };
      for (let i = 0; i < seriesMeta.length; i++) {
        row[seriesMeta[i].chartKey] = finiteN(maps[i].get(bucket) ?? 0);
      }
      return row;
    });
    return { rows, series: seriesMeta };
  }, [data]);

  const topComposition = useMemo(() => {
    if (!data) return [];
    return (data.composition ?? []).slice(0, 12).map((c) => {
      const url = typeof c?.typeUrl === "string" ? c.typeUrl : "";
      const n = Number(c?.count);
      return {
        name: url ? (url.split(".").pop() ?? url) : "(unknown type)",
        full: url,
        count: Number.isFinite(n) ? n : 0,
      };
    });
  }, [data]);

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
      <section className="flex flex-wrap items-end gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        <label className="flex flex-col gap-1 text-sm leading-[1.4]">
          <span className="text-[var(--muted)]">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[var(--text)] transition-colors hover:bg-[var(--color-bg-secondary)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm leading-[1.4]">
          <span className="text-[var(--muted)]">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[var(--text)] transition-colors hover:bg-[var(--color-bg-secondary)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm leading-[1.4]">
          <span className="text-[var(--muted)]">Granularity</span>
          <select
            value={granularity}
            onChange={(e) => setGranularity(e.target.value as Granularity)}
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[var(--text)] transition-colors hover:bg-[var(--color-bg-secondary)]"
          >
            <option value="hour">Hour (UTC)</option>
            <option value="day">Day</option>
            <option value="week">Week (UTC Monday)</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-on)] transition-transform hover:-translate-y-px hover:bg-[var(--color-accent-hover)] active:bg-[var(--color-accent-active)]"
        >
          Refresh
        </button>
        <p className="text-xs leading-[1.4] text-[var(--muted)]">
          {granularity === "hour"
            ? "Comparison: prior period of the same number of hours ending the hour before the range start (UTC)."
            : "Comparison: equal length ending the day before From."}
        </p>
      </section>

      {data?.indexer?.lastIndexedHeight && (
        <p className="text-xs text-[var(--muted)]">
          Last indexed block height:{" "}
          <code className="text-[var(--accent)]">{data.indexer.lastIndexedHeight}</code>
          {data.indexer.updatedAt && (
            <span className="ml-2">
              (indexer updated {new Date(data.indexer.updatedAt).toLocaleString()})
            </span>
          )}
        </p>
      )}

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
          <p className="text-sm text-[var(--muted)]">
            Value handled is primary on this page. In-tx transfer volume is multi-asset: add each denom in{" "}
            <code className="text-[var(--accent)]">src/config/denoms.json</code> for labels. Default
            paid fees in <code className="text-[var(--accent)]">{FEE_DENOM_UBLB}</code> are shown as
            BLD in the Gas and fees section; gas is a separate unit, not a token. Amounts are shown in
            native units (human-scaled when the denom is mapped in{" "}
            <code className="text-[var(--accent)]">denoms.json</code>).
          </p>

          <section className="space-y-6">
            <h2 className="text-xl font-semibold leading-tight tracking-tight text-[var(--color-accent)]">
              Value handled
            </h2>
            <div className="grid gap-4 lg:grid-cols-2 lg:gap-8">
              <KpiLargestMove
                largest={data.largestTransfer}
                display={data.display}
              />
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
                  In-tx transfer volume by denom (range total)
                </h3>
                <ul className="max-h-48 space-y-1 overflow-auto text-sm">
                  {Object.entries(data.transferVolumeByDenom ?? {})
                    .sort((a, b) => Number(b[1]) - Number(a[1]))
                    .slice(0, 20)
                    .map(([denom, amt]) => {
                      const r = data.display
                        ? listRow(amt, denom, data.display)
                        : { amountHuman: amt, symbol: "", rawDenom: denom };
                      return (
                        <li
                          key={denom}
                          className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)]/30 pb-1"
                        >
                          <div className="min-w-0">
                            {r.symbol ? (
                              <span className="font-mono text-[var(--text)]">
                                {r.amountHuman} {r.symbol}
                              </span>
                            ) : (
                              <code className="text-xs text-amber-200/90">{r.rawDenom}</code>
                            )}
                          </div>
                          <code className="max-w-[14rem] shrink-0 truncate text-[10px] text-[var(--muted)]">
                            {r.rawDenom}
                          </code>
                        </li>
                      );
                    })}
                </ul>
              </div>
            </div>

          <section className="space-y-8 lg:space-y-10">
            <TransferVolumeLineChart model={chartTransferValue} timeAxis={timeAxis} />
            <IbcAmountFlowsLineChart model={chartIbcValueAmounts} timeAxis={timeAxis} />
          </section>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold leading-tight tracking-tight text-[var(--color-accent)]">
              Gas and fees
            </h2>
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

          <section className="space-y-4">
            <h2 className="text-xl font-semibold leading-tight tracking-tight text-[var(--color-accent)]">
              Transaction activity
            </h2>
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

          <section className="space-y-8 lg:space-y-10">
            <AllTxVsIbcLineChart data={chartAllTxVsIbc} timeAxis={timeAxis} />
            <IbcTrafficLineChart data={chartIbcTraffic} timeAxis={timeAxis} />
          </section>

          <TransactionNatureBarChart
            data={topComposition}
            messageAttribution={MESSAGE_ATTRIBUTION}
          />
        </>
      )}

      <footer className="border-t border-[var(--border)] pt-6">
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

function KpiLargestMove({
  largest,
  display,
}: {
  largest: { denom: string; amount: string } | null;
  display?: EnrichedDisplay;
}) {
  const sub =
    "Largest MsgSend / MultiSend / IBC out amount in this range, by raw on-chain denom (any asset).";
  if (!largest) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
          Largest in-tx transfer
        </h3>
        <p className="mt-1 text-[10px] text-[var(--muted)]">{sub}</p>
        <p className="mt-2 text-2xl text-[var(--muted)]">—</p>
      </div>
    );
  }
  const m = display?.metas[largest.denom];
  const dec =
    m && typeof m.decimals === "number" && Number.isFinite(m.decimals) && m.decimals >= 0
      ? Math.min(18, m.decimals)
      : 6;
  const line = m
    ? `${atomicToHumanString(largest.amount, dec)} ${m.displaySymbol}`
    : `${largest.amount} (atomic) ${largest.denom.length > 24 ? largest.denom.slice(0, 20) + "…" : largest.denom}`;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
        Largest in-tx transfer
      </h3>
      <p className="mt-1 text-[10px] text-[var(--muted)]">{sub}</p>
      <p className="mt-2 font-mono text-xl text-[var(--text)]" title={largest.denom}>
        {line}
      </p>
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
      <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">{title}</h3>
      {subtitle && <p className="mt-1 text-[10px] text-[var(--muted)]">{subtitle}</p>}
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
