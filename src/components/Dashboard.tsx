"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { atomicToHumanString } from "@/lib/amountFormat";
import {
  formatHumanAxisLabel,
  formatUsd,
  listRow,
  valueToChartNumber,
} from "@/lib/displayFormat";
import type { EnrichedDisplay } from "@/lib/metricsDisplayTypes";
import { FEE_DENOM_UBLB, METHODOLOGY_BLURB, MESSAGE_ATTRIBUTION } from "@/lib/semantics";

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
    transferValueTop1: { denom: string; data: { bucket: string; value: string }[] };
    transferValueTop2: { denom: string; data: { bucket: string; value: string }[] } | null;
    ibcValueIn: { denom: string; data: { bucket: string; value: string }[] };
    ibcValueOut: { denom: string; data: { bucket: string; value: string }[] } | null;
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

export function Dashboard() {
  const defaults = useMemo(() => defaultDateRange(), []);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [granularity, setGranularity] = useState<Granularity>("hour");
  const [data, setData] = useState<MetricsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [methodologyOpen, setMethodologyOpen] = useState(false);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent;
      if (!silent) {
        setLoading(true);
        setErr(null);
      }
      try {
        const mRes = await fetch(
          `/api/metrics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&granularity=${granularity}`
        );
        if (!mRes.ok) {
          const j = await mRes.json().catch(() => ({}));
          throw new Error(j.error || mRes.statusText);
        }
        const m = (await mRes.json()) as MetricsPayload;
        setData(m);
        if (silent) setErr(null);
      } catch (e) {
        if (!silent) {
          setErr(e instanceof Error ? e.message : "Failed to load metrics");
          setData(null);
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [from, to, granularity]
  );

  useEffect(() => {
    void load();
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
        rows: [] as {
          bucket: string;
          a: number;
          b: number;
        }[],
        d1: "",
        d2: null as string | null,
        sym1: null as string | null,
        sym2: null as string | null,
      };
    }
    const t1 = data.series?.transferValueTop1;
    const t2 = data.series?.transferValueTop2;
    if (!t1) {
      return {
        rows: [] as { bucket: string; a: number; b: number }[],
        d1: "",
        d2: null as string | null,
        sym1: null as string | null,
        sym2: null as string | null,
      };
    }
    const d = data.display;
    const t1d = t1.data ?? [];
    const t2d = t2?.data ?? [];
    const aM = new Map(
      t1d.map((r) => [r.bucket, finiteN(valueToChartNumber(r.value, t1.denom, d))])
    );
    const bM = t2
      ? new Map(
          t2d.map((r) => [r.bucket, finiteN(valueToChartNumber(r.value, t2.denom, d))])
        )
      : new Map<string, number>();
    const keys = [...new Set([...aM.keys(), ...bM.keys()])].sort();
    return {
      rows: keys.map((bucket) => ({
        bucket,
        a: finiteN(aM.get(bucket) ?? 0),
        b: t2 ? finiteN(bM.get(bucket) ?? 0) : 0,
      })),
      d1: t1.denom,
      d2: t2?.denom ?? null,
      sym1: d?.metas[t1.denom]?.displaySymbol ?? null,
      sym2: t2?.denom ? d?.metas[t2.denom]?.displaySymbol ?? null : null,
    };
  }, [data]);

  const chartIbcValueAmounts = useMemo(() => {
    if (!data) {
      return {
        rows: [] as { bucket: string; inbox: number; outbox: number }[],
        denIn: "",
        denOut: null as string | null,
        symIn: null as string | null,
        symOut: null as string | null,
      };
    }
    const inn = data.series?.ibcValueIn;
    const outn = data.series?.ibcValueOut;
    if (!inn) {
      return {
        rows: [] as { bucket: string; inbox: number; outbox: number }[],
        denIn: "",
        denOut: null as string | null,
        symIn: null as string | null,
        symOut: null as string | null,
      };
    }
    const disp = data.display;
    const ind = inn.data ?? [];
    const outd = outn?.data ?? [];
    const inM = new Map(
      ind.map((r) => [r.bucket, finiteN(valueToChartNumber(r.value, inn.denom, disp))])
    );
    const outM = outn
      ? new Map(
          outd.map((r) => [r.bucket, finiteN(valueToChartNumber(r.value, outn.denom, disp))])
        )
      : new Map<string, number>();
    const keys = [...new Set([...inM.keys(), ...outM.keys()])].sort();
    return {
      rows: keys.map((bucket) => ({
        bucket,
        inbox: finiteN(inM.get(bucket) ?? 0),
        outbox: outM ? finiteN(outM.get(bucket) ?? 0) : 0,
      })),
      denIn: inn.denom,
      denOut: outn?.denom ?? null,
      symIn: disp?.metas[inn.denom]?.displaySymbol ?? null,
      symOut: outn?.denom ? disp?.metas[outn.denom]?.displaySymbol ?? null : null,
    };
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
        tick: { fill: "#8b93a7", fontSize: 9 },
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
      tick: { fill: "#8b93a7", fontSize: 11 },
      tickFormatter: (v: string) => formatBucketTick(v, g),
    };
  }, [granularity]);

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--muted)]">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[var(--text)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--muted)]">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[var(--text)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--muted)]">Granularity</span>
          <select
            value={granularity}
            onChange={(e) => setGranularity(e.target.value as Granularity)}
            className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[var(--text)]"
          >
            <option value="hour">Hour (UTC)</option>
            <option value="day">Day</option>
            <option value="week">Week (UTC Monday)</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-black hover:opacity-90"
        >
          Refresh
        </button>
        <p className="text-xs text-[var(--muted)]">
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
        <div className="rounded border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {err}
          <p className="mt-2 text-xs text-red-300/80">
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
            In-tx transfer volume is multi-asset: add each denom in{" "}
            <code className="text-[var(--accent)]">src/config/denoms.json</code> for labels. Default
            paid fees in <code className="text-[var(--accent)]">{FEE_DENOM_UBLB}</code> are shown as
            BLD; gas is a separate unit, not a token.
          </p>

          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KpiCard
              title="Successful txs"
              current={data.kpis.txSuccess.current}
              previous={data.kpis.txSuccess.previous}
              pct={data.kpis.txSuccess.pctChange}
            />
            <KpiLargestMove
              largest={data.largestTransfer}
              display={data.display}
            />
            <KpiCard
              title="Gas used"
              subtitle="ABCI / consensus gas units, not a token or BLD"
              current={data.kpis.gasUsed.current}
              previous={data.kpis.gasUsed.previous}
              pct={data.kpis.gasUsed.pctChange}
            />
            <KpiCard
              title="Paid fees (uBLD → BLD)"
              subtitle={`On-chain paid fee in ${FEE_DENOM_UBLB}; other fee denoms in table below.`}
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
          </section>

          <section className="grid gap-8 lg:grid-cols-2">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
              <h2 className="mb-1 text-sm font-medium text-[var(--muted)]">
                In-tx transfer volume (per asset)
              </h2>
              <p className="mb-4 text-xs text-[var(--muted)]">
                Value moved via MsgSend, MsgMultiSend, and outbound IBC amount fields — each line is
                a different on-chain asset (not a single BLD “TVL”). Chart shows the two denoms with
                largest in-range total; IBC receive amounts use a separate IBC section below. Map
                denoms in <code className="text-[var(--accent)]">src/config/denoms.json</code> for
                display symbols. Tooltips may show optional spot USD (CoinGecko) for comparison only.
              </p>
              {chartTransferValue.d1 ? (
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartTransferValue.rows}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#252a3a" />
                      <XAxis {...timeAxis} />
                      <YAxis
                        yAxisId="left"
                        tick={{ fill: "#8b93a7", fontSize: 10 }}
                        label={
                          chartTransferValue.sym1
                            ? { value: formatHumanAxisLabel(chartTransferValue.sym1), angle: -90, position: "insideLeft", style: { fill: "#6b7280" } }
                            : undefined
                        }
                      />
                      {chartTransferValue.d2 && (
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          tick={{ fill: "#8b93a7", fontSize: 10 }}
                          label={
                            chartTransferValue.sym2
                              ? { value: formatHumanAxisLabel(chartTransferValue.sym2), angle: 90, position: "insideRight", style: { fill: "#6b7280" } }
                              : undefined
                          }
                        />
                      )}
                      <Tooltip
                        content={({ label: lb, active, payload: pl }) =>
                          active && pl && pl.length ? (
                            <div
                              className="rounded border border-[#252a3a] p-2 text-xs"
                              style={{ background: "#141824" }}
                            >
                              <p className="text-[#8b93a7]">{String(lb)}</p>
                              {pl.map((e, i) => {
                                const y = e.value;
                                if (y == null || y === undefined) return null;
                                const denom = e.dataKey === "a" ? chartTransferValue.d1 : chartTransferValue.d2;
                                if (!denom) return <p key={i}>{e.name}: {y}</p>;
                                const m = data.display?.metas[denom];
                                const p =
                                  m?.coingeckoId && data.display?.usd[m.coingeckoId] != null
                                    ? m.coingeckoId
                                    : null;
                                const u =
                                  p && typeof y === "number"
                                    ? (y * (data.display!.usd[p] ?? 0))
                                    : null;
                                return (
                                  <p key={i} className="text-[#c4c8d4]">
                                    {e.name}: {typeof y === "number" ? y.toLocaleString() : y}
                                    {u != null && !Number.isNaN(u) && (
                                      <span className="ml-1 text-[#7dd3a0]">
                                        (≈ {formatUsd(u)})
                                      </span>
                                    )}
                                  </p>
                                );
                              })}
                            </div>
                          ) : null
                        }
                      />
                      <Legend
                        wrapperStyle={{ fontSize: 11 }}
                        formatter={(v) => (
                          <span className="text-[#c4c8d4] max-w-[200px] truncate" title={v}>
                            {v}
                          </span>
                        )}
                      />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="a"
                        name={chartTransferValue.sym1 || chartTransferValue.d1}
                        stroke="#4ade80"
                        dot={false}
                      />
                      {chartTransferValue.d2 && (
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="b"
                          name={chartTransferValue.sym2 || chartTransferValue.d2}
                          stroke="#4f46e5"
                          dot={false}
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-[var(--muted)]">
                  No bank / outbound IBC transfer amounts in the selected range.
                </p>
              )}
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
              <h2 className="mb-1 text-sm font-medium text-[var(--muted)]">
                IBC amount flows (separate from bank sends above)
              </h2>
              <p className="mb-4 text-xs text-[var(--muted)]">
                In = recv / event-sourced; out = IBC out msg. One vertical scale for both; legend
                shows which asset each line is (in vs out can be different denoms). Not comparable
                to bank+IBC out “transfer” chart, or to BLD-denominated fees.
              </p>
              {chartIbcValueAmounts.denIn || chartIbcValueAmounts.denOut ? (
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartIbcValueAmounts.rows}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#252a3a" />
                      <XAxis {...timeAxis} />
                      {/** yAxisId 0 must match Line; single scale. */}
                      <YAxis yAxisId={0} tick={{ fill: "#8b93a7", fontSize: 10 }} />
                      <Tooltip
                        content={({ label: lb, active, payload: pl }) =>
                          active && pl && pl.length ? (
                            <div
                              className="rounded border border-[#252a3a] p-2 text-xs"
                              style={{ background: "#141824" }}
                            >
                              <p className="text-[#8b93a7]">{String(lb)}</p>
                              {pl.map((e, i) => {
                                const y = e.value;
                                if (y == null || y === undefined) return null;
                                const denom =
                                  e.dataKey === "inbox" ? chartIbcValueAmounts.denIn : chartIbcValueAmounts.denOut;
                                if (!denom) return <p key={i}>{e.name}: {y}</p>;
                                const m = data.display?.metas[denom];
                                const cgid = m?.coingeckoId;
                                const u =
                                  cgid && data.display?.usd[cgid] != null && typeof y === "number"
                                    ? y * (data.display.usd[cgid] ?? 0)
                                    : null;
                                return (
                                  <p key={i} className="text-[#c4c8d4]">
                                    {e.name}: {typeof y === "number" ? y.toLocaleString() : y}
                                    {u != null && !Number.isNaN(u) && (
                                      <span className="ml-1 text-[#7dd3a0]">(≈ {formatUsd(u)})</span>
                                    )}
                                  </p>
                                );
                              })}
                            </div>
                          ) : null
                        }
                      />
                      <Legend
                        wrapperStyle={{ fontSize: 11 }}
                        formatter={(v) => (
                          <span className="text-[#c4c8d4] max-w-[200px] truncate" title={v}>
                            {v}
                          </span>
                        )}
                      />
                      {chartIbcValueAmounts.denIn && (
                        <Line
                          yAxisId={0}
                          type="monotone"
                          dataKey="inbox"
                          name={`${chartIbcValueAmounts.symIn || chartIbcValueAmounts.denIn} in`}
                          stroke="#22d3ee"
                          dot={false}
                        />
                      )}
                      {chartIbcValueAmounts.denOut && (
                        <Line
                          yAxisId={0}
                          type="monotone"
                          dataKey="outbox"
                          name={`${chartIbcValueAmounts.symOut || chartIbcValueAmounts.denOut} out`}
                          stroke="#e879f9"
                          dot={false}
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-[var(--muted)]">No IBC in/out amount data in this range.</p>
              )}
            </div>
          </section>

          <section className="grid gap-8 lg:grid-cols-2">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
              <h2 className="mb-1 text-sm font-medium text-[var(--muted)]">
                All transactions and IBC message volume
              </h2>
              <p className="mb-4 text-xs text-[var(--muted)]">
                All txs = success + failed (inclusions). IBC = outbound MsgTransfer + recv
                (ICS-20 handling), per bucket. One vertical scale for both (counts per bucket).
              </p>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartAllTxVsIbc}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#252a3a" />
                    <XAxis {...timeAxis} />
                    <YAxis yAxisId={0} tick={{ fill: "#8b93a7", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        background: "#141824",
                        border: "1px solid #252a3a",
                      }}
                    />
                    <Legend />
                    <Line
                      yAxisId={0}
                      type="monotone"
                      dataKey="totalTx"
                      name="All transactions"
                      stroke="#6ee7b7"
                      dot={false}
                    />
                    <Line
                      yAxisId={0}
                      type="monotone"
                      dataKey="ibcMsgs"
                      name="IBC (out + recv)"
                      stroke="#a78bfa"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
              <h2 className="mb-1 text-sm font-medium text-[var(--muted)]">
                IBC traffic: out vs received
              </h2>
              <p className="mb-4 text-xs text-[var(--muted)]">
                Transfers out (MsgTransfer) and recv packet handling, per bucket.
              </p>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartIbcTraffic}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#252a3a" />
                    <XAxis {...timeAxis} />
                    <YAxis yAxisId={0} tick={{ fill: "#8b93a7", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        background: "#141824",
                        border: "1px solid #252a3a",
                      }}
                    />
                    <Legend />
                    <Line
                      yAxisId={0}
                      type="monotone"
                      dataKey="out"
                      name="IBC out"
                      stroke="#38bdf8"
                      dot={false}
                    />
                    <Line
                      yAxisId={0}
                      type="monotone"
                      dataKey="recv"
                      name="IBC received"
                      stroke="#f472b6"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="mb-2 text-sm font-medium text-[var(--muted)]">
              Transaction nature (first message only — {MESSAGE_ATTRIBUTION})
            </h2>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topComposition} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#252a3a" />
                  <XAxis type="number" tick={{ fill: "#8b93a7", fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={78}
                    tick={{ fill: "#8b93a7", fontSize: 10 }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#141824",
                      border: "1px solid #252a3a",
                    }}
                    formatter={(value: number) => [value, "count"]}
                  />
                  <Bar dataKey="count" fill="#6ee7b7" name="Txs" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                Fee paid by denom (range total, not in-tx value)
              </h3>
              <p className="mb-2 text-[10px] text-[var(--muted)]">
                Shown in primary units; no USD. KPI above is the uBLD fee total in BLD.
              </p>
              <ul className="max-h-48 space-y-1 overflow-auto text-sm">
                {Object.entries(data.feePaidByDenom ?? {})
                  .sort((a, b) => Number(b[1]) - Number(a[1]))
                  .slice(0, 20)
                  .map(([denom, amt]) => {
                    const r = data.display
                      ? listRow(amt, denom, data.display, { includeUsd: false })
                      : { amountHuman: amt, symbol: "", usdLine: null, rawDenom: denom };
                    return (
                      <li
                        key={denom}
                        className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)]/30 pb-1"
                      >
                        {r.symbol ? (
                          <span className="font-mono text-[var(--text)]">
                            {r.amountHuman} {r.symbol}
                          </span>
                        ) : (
                          <span className="font-mono text-xs text-amber-200/90">atomic {r.amountHuman}</span>
                        )}
                        <code className="max-w-[12rem] truncate text-[10px] text-[var(--muted)]">
                          {r.rawDenom}
                        </code>
                      </li>
                    );
                  })}
              </ul>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                In-tx transfer volume by denom (range total)
              </h3>
              {data.display && !data.display.pricingFromCoinGecko && (
                <p className="mb-2 text-[10px] text-amber-300/90">
                  Optional spot USD in this column from CoinGecko. Set api key if rate-limited.
                </p>
              )}
              <ul className="max-h-48 space-y-1 overflow-auto text-sm">
                {Object.entries(data.transferVolumeByDenom ?? {})
                  .sort((a, b) => Number(b[1]) - Number(a[1]))
                  .slice(0, 20)
                  .map(([denom, amt]) => {
                    const r = data.display
                      ? listRow(amt, denom, data.display, { includeUsd: true })
                      : { amountHuman: amt, symbol: "", usdLine: null, rawDenom: denom };
                    return (
                      <li
                        key={denom}
                        className="flex flex-col gap-0.5 border-b border-[var(--border)]/30 pb-1 sm:flex-row sm:justify-between sm:gap-2"
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
                        <div className="shrink-0 text-right text-xs text-[var(--muted)]">
                          {r.usdLine
                            ? r.usdLine
                            : r.symbol
                              ? "—"
                              : "atomic, add denom to config for symbol / USD"}
                        </div>
                      </li>
                    );
                  })}
              </ul>
            </div>
          </section>
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
          <pre className="mt-4 whitespace-pre-wrap rounded border border-[var(--border)] bg-[var(--surface)] p-4 text-xs text-[var(--muted)]">
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
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
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
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
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
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{title}</h3>
      {subtitle && <p className="mt-1 text-[10px] text-[var(--muted)]">{subtitle}</p>}
      <p className="mt-2 font-mono text-2xl text-[var(--text)]">{current}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Prior window: <span className="font-mono text-[var(--text)]">{previous}</span>
        {" · "}
        <span className={pct !== null && pct >= 0 ? "text-emerald-400" : "text-amber-300"}>
          {fmtPct(pct)}
        </span>
      </p>
    </div>
  );
}
