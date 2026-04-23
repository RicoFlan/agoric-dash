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
import { METHODOLOGY_BLURB, MESSAGE_ATTRIBUTION } from "@/lib/semantics";

type Granularity = "day" | "week";

interface MetricsPayload {
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
  };
  series: {
    txSuccess: { bucket: string; value: string }[];
    txSuccessMa7: { bucket: string; ma: string }[];
    feesPaidByTopDenom: { bucket: string; denom: string; value: string }[];
  };
  composition: { typeUrl: string; count: string }[];
  transferVolumeByDenom: Record<string, string>;
  feePaidByDenom: Record<string, string>;
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

export function Dashboard() {
  const defaults = useMemo(() => defaultDateRange(), []);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [data, setData] = useState<MetricsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [methodologyOpen, setMethodologyOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
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
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load metrics");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, granularity]);

  useEffect(() => {
    void load();
  }, [load]);

  const chartTx = useMemo(() => {
    if (!data) return [];
    const maMap = new Map(data.series.txSuccessMa7.map((x) => [x.bucket, x.ma]));
    return data.series.txSuccess.map((row) => ({
      bucket: row.bucket,
      txs: Number(row.value),
      ma7: Number(maMap.get(row.bucket) ?? 0),
    }));
  }, [data]);

  const chartFees = useMemo(() => {
    if (!data) return [];
    return data.series.feesPaidByTopDenom.map((row) => ({
      bucket: row.bucket,
      amount: Number(row.value),
      denom: row.denom,
    }));
  }, [data]);

  const topComposition = useMemo(() => {
    if (!data) return [];
    return data.composition.slice(0, 12).map((c) => ({
      name: c.typeUrl.split(".").pop() ?? c.typeUrl,
      full: c.typeUrl,
      count: Number(c.count),
    }));
  }, [data]);

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
          Comparison window: equal length ending the day before &quot;From&quot;
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

      {data && (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KpiCard
              title="Successful txs"
              current={data.kpis.txSuccess.current}
              previous={data.kpis.txSuccess.previous}
              pct={data.kpis.txSuccess.pctChange}
            />
            <KpiCard
              title="Gas used (units)"
              current={data.kpis.gasUsed.current}
              previous={data.kpis.gasUsed.previous}
              pct={data.kpis.gasUsed.pctChange}
            />
            <KpiCard
              title="Paid fees (sum raw denoms)"
              subtitle="Do not treat as one currency"
              current={data.kpis.feesPaidAllDenoms.current}
              previous={data.kpis.feesPaidAllDenoms.previous}
              pct={data.kpis.feesPaidAllDenoms.pctChange}
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
              <h2 className="mb-4 text-sm font-medium text-[var(--muted)]">
                Successful transactions
              </h2>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartTx}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#252a3a" />
                    <XAxis dataKey="bucket" tick={{ fill: "#8b93a7", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#8b93a7", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        background: "#141824",
                        border: "1px solid #252a3a",
                      }}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="txs" name="Txs" stroke="#6ee7b7" dot={false} />
                    <Line
                      type="monotone"
                      dataKey="ma7"
                      name="Moving avg (window)"
                      stroke="#93c5fd"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
              <h2 className="mb-4 text-sm font-medium text-[var(--muted)]">
                Paid fees — top denom in range
              </h2>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartFees}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#252a3a" />
                    <XAxis dataKey="bucket" tick={{ fill: "#8b93a7", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#8b93a7", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        background: "#141824",
                        border: "1px solid #252a3a",
                      }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="amount"
                      name="Fee amount"
                      stroke="#fbbf24"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {chartFees[0]?.denom && (
                <p className="mt-2 text-xs text-[var(--muted)]">
                  Denom: <code className="text-[var(--accent)]">{chartFees[0].denom}</code>
                </p>
              )}
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
                Fee paid by denom (range total)
              </h3>
              <ul className="max-h-48 space-y-1 overflow-auto text-sm">
                {Object.entries(data.feePaidByDenom)
                  .sort((a, b) => Number(b[1]) - Number(a[1]))
                  .slice(0, 20)
                  .map(([denom, amt]) => (
                    <li key={denom} className="flex justify-between gap-2">
                      <code className="truncate text-xs text-[var(--accent)]">{denom}</code>
                      <span className="shrink-0 font-mono text-[var(--text)]">{amt}</span>
                    </li>
                  ))}
              </ul>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                Transfer-like volume by denom (range total)
              </h3>
              <ul className="max-h-48 space-y-1 overflow-auto text-sm">
                {Object.entries(data.transferVolumeByDenom)
                  .sort((a, b) => Number(b[1]) - Number(a[1]))
                  .slice(0, 20)
                  .map(([denom, amt]) => (
                    <li key={denom} className="flex justify-between gap-2">
                      <code className="truncate text-xs text-[var(--accent)]">{denom}</code>
                      <span className="shrink-0 font-mono text-[var(--text)]">{amt}</span>
                    </li>
                  ))}
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
