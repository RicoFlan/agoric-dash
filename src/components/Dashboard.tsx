"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MethodologyPanel } from "@/components/dashboard/MethodologyPanel";
import { Q1Busier } from "@/components/dashboard/questions/Q1Busier";
import { Q2Organic } from "@/components/dashboard/questions/Q2Organic";
import { Q3ValueFlow } from "@/components/dashboard/questions/Q3ValueFlow";
import { Q4Base } from "@/components/dashboard/questions/Q4Base";
import type { Granularity, MetricsPayload } from "@/components/dashboard/types";
import { chartTheme } from "@/lib/chartTheme";
import { dashboardSectionIds } from "@/lib/dashboardNav";
import { INDEXED_HISTORY_FROM_DAY, METHODOLOGY_SECTIONS } from "@/lib/semantics";

/**
 * Page shell: range/granularity controls, the metrics fetch, and the four question sections
 * (docs: "Four Questions", P3). Each section owns its own derived rows; this file owns state.
 */

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
  "rounded-md border-2 border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs font-medium text-[var(--text)] transition-colors hover:bg-[var(--color-bg-secondary)]";

const QUICK_RANGE_BTN_ACTIVE =
  "border-2 border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_14%,var(--bg))] font-semibold text-[var(--color-text-primary)] shadow-md ring-2 ring-[var(--color-accent)]/45";

function activeQuickPreset(from: string, to: string, g: Granularity): "24h" | "week" | "30" | "90" | null {
  const t0 = utcCalendarDate(0);
  if (from === t0 && to === t0 && g === "hour") return "24h";
  if (from === utcCalendarDate(-6) && to === t0 && g === "day") return "week";
  if (from === utcCalendarDate(-29) && to === t0 && g === "day") return "30";
  if (from === utcCalendarDate(-89) && to === t0 && g === "day") return "90";
  return null;
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

function isLocalDevHostname(h: string): boolean {
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

function isMetricsFailureLocalHost(): boolean {
  if (typeof window === "undefined") return false;
  return isLocalDevHostname(window.location.hostname);
}

const HINT_P = "mt-2 text-xs opacity-90 leading-relaxed" as const;
const HINT_CODE = "text-[var(--accent)]" as const;

/** Second line under metrics fetch errors: local dev vs deployed host. */
function MetricsFailureSetupHint() {
  const [local, setLocal] = useState<boolean | null>(null);
  useEffect(() => {
    setLocal(isMetricsFailureLocalHost());
  }, []);
  if (local === null) return null;
  if (local) {
    return (
      <p className={HINT_P} style={{ color: "var(--color-text-secondary)" }}>
        Start Postgres (<code className={HINT_CODE}>docker compose up -d</code>), run{" "}
        <code className={HINT_CODE}>npm run db:push</code>, then <code className={HINT_CODE}>npm run indexer</code>.
      </p>
    );
  }
  return (
    <p className={HINT_P} style={{ color: "var(--color-text-secondary)" }}>
      The app needs <code className={HINT_CODE}>DATABASE_URL</code> to a reachable Postgres instance, schema applied via{" "}
      <code className={HINT_CODE}>npm run db:push</code>, and a running <code className={HINT_CODE}>npm run indexer</code>{" "}
      (same URL plus <code className={HINT_CODE}>RPC_URL</code>) so rollup tables are populated.
    </p>
  );
}

export function Dashboard() {
  /** Default load: last 30 calendar days (daily buckets); custom pickers stay hidden until "Custom Range". */
  const [from, setFrom] = useState(() => clampDayNotBeforeIndexed(utcCalendarDate(-29)));
  const [to, setTo] = useState(() => utcCalendarDate(0));
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [customRangeOpen, setCustomRangeOpen] = useState(false);
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
      const requestedFrom = from;
      const requestedTo = to;
      try {
        const mRes = await fetch(
          `/api/metrics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&granularity=${granularity}`,
          { signal: ctrl.signal }
        );
        const ct = mRes.headers.get("content-type") ?? "";
        if (!mRes.ok) {
          const j = (await mRes.json().catch(() => ({}))) as { error?: string };
          const hint =
            typeof j.error === "string"
              ? j.error
              : ct.includes("application/json")
                ? mRes.statusText
                : `Server error (${mRes.status}). If you use \`next dev\`, try \`rm -rf .next\` and restart, or \`npm run dev:clean\`.`;
          throw new Error(hint || mRes.statusText);
        }
        if (!ct.includes("application/json")) {
          throw new Error("Unexpected response from /api/metrics (not JSON). Try `rm -rf .next` and restart the dev server.");
        }
        const m = (await mRes.json()) as MetricsPayload;
        if (metricsFlightRef.current !== ctrl) return;
        setData(m);
        if (m.range?.from && m.range?.to && (m.range.from !== requestedFrom || m.range.to !== requestedTo)) {
          setFrom(m.range.from);
          setTo(m.range.to);
        }
        if (silent) setErr(null);
      } catch (e) {
        if (metricsFlightRef.current !== ctrl) return;
        if (!silent) {
          const aborted = e instanceof DOMException && e.name === "AbortError";
          const msg = aborted
            ? isMetricsFailureLocalHost()
              ? "Loading metrics timed out or was cancelled. Check Postgres, run `npm run dev:clean` if the dev server returns 500."
              : "Loading metrics timed out. Check DATABASE_URL, that Postgres accepts connections from this host, and pooler/firewall rules."
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

  /** Chart-grain X axis shared by the per-bucket charts. */
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
    <div className="space-y-12">
      {data?.indexer?.lastIndexedHeight && (
        <p className="text-left text-xs font-bold text-[var(--color-text-secondary)]">
          Last indexed block height: <code className="font-bold text-[var(--accent)]">{data.indexer.lastIndexedHeight}</code>
          {data.indexer.updatedAt && (
            <span className="ml-2 font-bold">(indexer updated {new Date(data.indexer.updatedAt).toLocaleString()})</span>
          )}
        </p>
      )}

      {data?.granularity === "hour" && data.usedDailyFallbackForHourView && (
        <p
          className="rounded-md border px-3 py-2 text-xs leading-snug"
          style={{
            borderColor: "color-mix(in srgb, var(--color-accent) 35%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--color-accent) 8%, var(--color-bg-primary))",
            color: "var(--color-text-secondary)",
          }}
        >
          No rows in <code className="text-[var(--accent)]">hourly_metrics</code> for this range; the API fell back to{" "}
          <strong className="font-medium text-[var(--color-text-primary)]">daily</strong> rollups so values are not all
          zero. For a true hourly breakdown, ensure the indexer has written hourly data.
        </p>
      )}

      <section
        id={dashboardSectionIds.filters}
        className="scroll-mt-6 flex flex-wrap items-end gap-4 rounded-lg border border-[var(--border)] bg-[var(--color-bg-control)] p-5 shadow-[var(--shadow-card)]"
      >
        <div className="flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-3 border-b border-[var(--border)]/60 pb-4">
          <label className="flex shrink-0 flex-row items-center gap-2 text-sm leading-[1.4]">
            <span className="whitespace-nowrap text-sm font-medium text-[var(--color-text-secondary)]">Granularity</span>
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
          <div className="flex min-h-0 min-w-0 flex-wrap items-center justify-center gap-2">
            <span className="mr-1 text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">Date range</span>
            <button
              type="button"
              className={`${QUICK_RANGE_BTN} ${!customRangeOpen && activeQuickPreset(from, to, granularity) === "24h" ? QUICK_RANGE_BTN_ACTIVE : ""}`}
              title="UTC: current calendar day only (24 hourly buckets, 00:00–23:00 UTC)."
              onClick={() => {
                setCustomRangeOpen(false);
                const today = clampDayNotBeforeIndexed(utcCalendarDate(0));
                setFrom(today);
                setTo(today);
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
          <div className="flex w-full flex-wrap items-center justify-center gap-4 border-b border-[var(--border)]/60 pb-4">
            <label className="flex flex-row items-center gap-2 text-sm leading-[1.4]">
              <span className="whitespace-nowrap text-sm font-medium text-[var(--color-text-secondary)]">From</span>
              <input
                type="date"
                min={INDEXED_HISTORY_FROM_DAY}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[var(--text)] transition-colors hover:bg-[var(--color-bg-secondary)]"
              />
            </label>
            <label className="flex flex-row items-center gap-2 text-sm leading-[1.4]">
              <span className="whitespace-nowrap text-sm font-medium text-[var(--color-text-secondary)]">To</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[var(--text)] transition-colors hover:bg-[var(--color-bg-secondary)]"
              />
            </label>
          </div>
        )}
        <p className="w-full text-center text-xs leading-[1.4] text-[var(--muted)]">
          <span className="font-bold">
            Indexed rollups and participation metrics start <time dateTime={INDEXED_HISTORY_FROM_DAY}>{INDEXED_HISTORY_FROM_DAY}</time>{" "}
            UTC.
          </span>{" "}
          The API clamps <strong className="font-medium text-[var(--color-text-secondary)]">From</strong> to that day when
          needed so results match the indexer window. Every comparison is against an equal-length window ending just before From.
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
          <MetricsFailureSetupHint />
        </div>
      )}

      {loading && !data && !err && <p className="text-[var(--muted)]">Loading metrics…</p>}

      {data && data.kpis && (
        <>
          <Q1Busier data={data} q={data.questions?.q1} granularity={granularity} timeAxis={timeAxis} />
          <Q2Organic data={data} q={data.questions?.q2} timeAxis={timeAxis} />
          <Q3ValueFlow data={data} q={data.questions?.q3} timeAxis={timeAxis} />
          <Q4Base data={data} q={data.questions?.q4} from={from} to={to} />
        </>
      )}

      <footer id={dashboardSectionIds.methodology} className="scroll-mt-6 border-t border-[var(--border)] pt-6">
        <button type="button" onClick={() => setMethodologyOpen((o) => !o)} className="text-sm text-[var(--accent)] hover:underline">
          {methodologyOpen ? "Hide methodology" : "Methodology & caveats"}
        </button>
        {methodologyOpen && <MethodologyPanel sections={METHODOLOGY_SECTIONS} />}
      </footer>
    </div>
  );
}
