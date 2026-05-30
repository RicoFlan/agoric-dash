"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChartChunkFallback } from "@/components/dashboard/ChartChunkFallback";
import { atomicToFloat, atomicToHumanString } from "@/lib/amountFormat";
import { listRow } from "@/lib/displayFormat";
import { chartTheme } from "@/lib/chartTheme";
import type { EnrichedDisplay } from "@/lib/metricsDisplayTypes";
import { sortGrossMovementRows, type GrossMovementRow } from "@/lib/grossTableUsdSort";
import { dashboardSectionIds } from "@/lib/dashboardNav";
import { filledDistinctAccountsPerDay } from "@/lib/filledDistinctAccountsSeries";
import { buildSuccessRateRows } from "@/lib/successRateSeries";
import { buildGasUtilizationRows } from "@/lib/gasUtilizationSeries";
import { buildStakingGovActivityRows } from "@/lib/stakingGovActivitySeries";
import { buildOffersActivityRows } from "@/lib/offersActivitySeries";
import type { ConcentrationTimePoint } from "@/lib/concentrationTimeseries";
import {
  FEE_DENOM_UBLB,
  INDEXED_HISTORY_FROM_DAY,
  INDEXER_SCOPE_CAVEAT_INLINE,
  INDEXER_SCOPE_CAVEAT_SUBTITLE,
  METHODOLOGY_SECTIONS,
} from "@/lib/semantics";
import { MethodologyPanel } from "@/components/dashboard/MethodologyPanel";
import ValueFlowMap from "@/components/dashboard/ValueFlowMap";
import { formatRatePct } from "@/lib/txSuccessRate";

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

const TxSuccessRateLineChart = dynamic(
  () => import("@/components/dashboard/charts/TxSuccessRateLineChart"),
  {
    loading: () => <ChartChunkFallback title="Transaction success rate" />,
    ssr: false,
  }
);

const GasUtilizationLineChart = dynamic(
  () => import("@/components/dashboard/charts/GasUtilizationLineChart"),
  {
    loading: () => <ChartChunkFallback title="Block-space utilization" />,
    ssr: false,
  }
);

const StakingGovActivityLineChart = dynamic(
  () => import("@/components/dashboard/charts/StakingGovActivityLineChart"),
  {
    loading: () => <ChartChunkFallback title="Staking & governance activity" />,
    ssr: false,
  }
);

const ConcentrationLineChart = dynamic(
  () => import("@/components/dashboard/charts/ConcentrationLineChart"),
  {
    loading: () => <ChartChunkFallback title="Concentration over time" />,
    ssr: false,
  }
);

const OffersActivityLineChart = dynamic(
  () => import("@/components/dashboard/charts/OffersActivityLineChart"),
  {
    loading: () => <ChartChunkFallback title="Smart-wallet offer activity" />,
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

type KpiDelta = { current: string; previous: string; pctChange: number | null };
type OfferLabeledCount = { key: string; label: string; count: string };

interface MetricsPayload {
  granularity?: Granularity;
  display?: EnrichedDisplay;
  range: { from: string; to: string };
  comparisonWindow: { from: string; to: string };
  kpis: {
    txSuccess: { current: string; previous: string; pctChange: number | null };
    txFailed: { current: string; previous: string; pctChange: number | null };
    /** Success rate % (0–100), or null when no aligned txs in the window. */
    successRatePct: { current: number | null; previous: number | null };
    gasUsed: { current: string; previous: string; pctChange: number | null };
    gasWanted: { current: string; previous: string; pctChange: number | null };
    /** Gas efficiency % = gas_used / gas_wanted, or null when no gas requested. */
    gasEfficiencyPct: { current: number | null; previous: number | null };
    blockGasLimit: { current: string; previous: string; pctChange: number | null };
    /** Block-space utilization % = gas_used / block_gas_limit, or null when no limit recorded. */
    blockGasUtilizationPct: { current: number | null; previous: number | null };
    /** MsgTransfer message totals (`ibc_transfer_out_count`). */
    ibcOutboundMsgCount: {
      current: string;
      previous: string;
      pctChange: number | null;
    };
    /** Inbound recv-flow headline totals (ibc_transfer_flow_in display rollup). */
    ibcInboundRecvFlowCount: {
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
    stakingDelegations: { current: string; previous: string; pctChange: number | null };
    stakingUndelegations: { current: string; previous: string; pctChange: number | null };
    stakingRedelegations: { current: string; previous: string; pctChange: number | null };
    govVotes: { current: string; previous: string; pctChange: number | null };
    govProposals: { current: string; previous: string; pctChange: number | null };
  };
  series: {
    txTotal: { bucket: string; value: string }[];
    txFailed: { bucket: string; value: string }[];
    ibcCombinedCounts: { bucket: string; value: string }[];
    ibcOutboundMsgs: { bucket: string; value: string }[];
    ibcInboundRecvFlows: { bucket: string; value: string }[];
    gasUsed: { bucket: string; value: string }[];
    gasWanted: { bucket: string; value: string }[];
    blockGasLimit: { bucket: string; value: string }[];
    stakingGov: {
      delegations: { bucket: string; value: string }[];
      undelegations: { bucket: string; value: string }[];
      redelegations: { bucket: string; value: string }[];
      govVotes: { bucket: string; value: string }[];
      govProposals: { bucket: string; value: string }[];
    };
    transferVolumeSeries: { denom: string; data: { bucket: string; value: string }[] }[];
    bankCreditsVolumeSeries: { denom: string; data: { bucket: string; value: string }[] }[];
    ibcAmountInSeries: { denom: string; data: { bucket: string; value: string }[] }[];
    ibcAmountOutSeries: { denom: string; data: { bucket: string; value: string }[] }[];
  };
  transferVolumeByDenom: Record<string, string>;
  bankCreditsVolumeByDenom: Record<string, string>;
  transferVolumeUsdByDenom: Record<string, string | null>;
  bankCreditsVolumeUsdByDenom: Record<string, string | null>;
  transferVolumeUsdTotal: string | null;
  bankCreditsVolumeUsdTotal: string | null;
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
    top10AddressShareFeesUsd: string | null;
    grossUsdHhi: string | null;
    feesUsdHhi: string | null;
  };
  /** Distinct sending addresses per denom (range); wash-resistance context for the Value Flow Map. */
  distinctSendersByDenom?: Record<string, number>;
  /** Daily concentration trend (HHI + top-10 share) for gross-movement USD and paid-fee USD. */
  concentrationOverTime?: ConcentrationTimePoint[];
  /** Denominator-aware ratios (descriptive); "—" when a denominator is zero or USD is unpriced. */
  normalizedRatios?: {
    gasPerTx: string;
    feeBldPerSuccessfulTx: string;
    successfulTxsPerActiveAddress: string;
    grossUsdPerActiveAddress: string;
  };
  /** SwingSet/Zoe smart-wallet offer activity (intent surfacing) with distinct-wallet participation. */
  offers?: {
    kpis: {
      totalActions: KpiDelta;
      zoeOffers: KpiDelta;
      walletInvocations: KpiDelta;
      automatedActions: KpiDelta;
      interactiveActions: KpiDelta;
    };
    outcomes: {
      settled: KpiDelta;
      wantsSatisfied: KpiDelta;
      wantsUnsatisfied: KpiDelta;
      errored: KpiDelta;
      satisfactionRatePct: number | null;
      overTime: { outcome: string; data: { bucket: string; value: string }[] }[];
    };
    byCategory: { category: string; automation: string; count: string }[];
    bySource: OfferLabeledCount[];
    byInstance: OfferLabeledCount[];
    byMaker: OfferLabeledCount[];
    byTarget: OfferLabeledCount[];
    categoriesOverTime: { category: string; data: { bucket: string; value: string }[] }[];
    totalOverTime: { bucket: string; value: string }[];
    value: {
      giveByDenom: Record<string, string>;
      wantByDenom: Record<string, string>;
      payoutByDenom: Record<string, string>;
    };
    participants: {
      distinctWallets: number;
      distinctZoeOfferWallets: number;
      distinctInvocationWallets: number;
      perDay: { day: string; count: number }[];
    };
  };
  /** USD valuation of offer give/want/payout native totals (current spot; gross flow). */
  offerValueUsd?: {
    give: { byDenom: Record<string, string | null>; total: string | null };
    want: { byDenom: Record<string, string | null>; total: string | null };
    payouts: { byDenom: Record<string, string | null>; total: string | null };
    usdPricingMeta: { source: "coingecko"; spotFetchedAt: string | null; partialOrStale: boolean };
  } | null;
  /** First day included in indexed DB rollups (UTC); requests earlier than this are clamped. */
  indexedHistoryFromDay?: string;
  /** True when hour granularity was requested but `hourly_metrics` had no rows, so daily rollups were used for charts/KPIs. */
  usedDailyFallbackForHourView?: boolean;
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
  "rounded-md border-2 border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs font-medium text-[var(--text)] transition-colors hover:bg-[var(--color-bg-secondary)]";

const QUICK_RANGE_BTN_ACTIVE =
  "border-2 border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_14%,var(--bg))] font-semibold text-[var(--color-text-primary)] shadow-md ring-2 ring-[var(--color-accent)]/45";

function activeQuickPreset(
  from: string,
  to: string,
  g: Granularity
): "24h" | "week" | "30" | "90" | null {
  const t0 = utcCalendarDate(0);
  if (from === t0 && to === t0 && g === "hour") return "24h";
  if (from === utcCalendarDate(-6) && to === t0 && g === "day") return "week";
  if (from === utcCalendarDate(-29) && to === t0 && g === "day") return "30";
  if (from === utcCalendarDate(-89) && to === t0 && g === "day") return "90";
  return null;
}

/** docs/style-guide.md §2 — top-level section rails: accent (H2 / 20px) + left rail */
const SECTION_HEADING_CLASS =
  "border-l-2 border-[var(--color-accent)] pl-3 text-xl font-semibold leading-tight tracking-tight text-[var(--color-accent)]";

/** Section intro copy under H2 — full content width (matches chart/card panels). */
const SECTION_INTRO_CLASS = "w-full text-xs leading-snug text-[var(--muted)]";

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

function isLocalDevHostname(h: string): boolean {
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

function isMetricsFailureLocalHost(): boolean {
  if (typeof window === "undefined") return false;
  return isLocalDevHostname(window.location.hostname);
}

const HINT_P =
  "mt-2 text-xs opacity-90 leading-relaxed" as const;
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
        <code className={HINT_CODE}>npm run db:push</code>, then{" "}
        <code className={HINT_CODE}>npm run indexer</code>.
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

  /** Fixed-position denom tooltip (portal) so it is not clipped by the table scroll wrapper. */
  const [denomTip, setDenomTip] = useState<{ text: string; left: number; top: number } | null>(null);
  const denomTipHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [denomTipPortalReady, setDenomTipPortalReady] = useState(false);

  const clearDenomTipHideTimer = useCallback(() => {
    if (denomTipHideTimerRef.current) {
      clearTimeout(denomTipHideTimerRef.current);
      denomTipHideTimerRef.current = null;
    }
  }, []);

  const showDenomTip = useCallback(
    (text: string, anchor: HTMLElement) => {
      clearDenomTipHideTimer();
      const r = anchor.getBoundingClientRect();
      const margin = 8;
      const maxW = 448;
      const left = Math.max(margin, Math.min(r.left, window.innerWidth - margin - maxW));
      setDenomTip({ text, left, top: r.bottom + 6 });
    },
    [clearDenomTipHideTimer]
  );

  const scheduleHideDenomTip = useCallback(() => {
    clearDenomTipHideTimer();
    denomTipHideTimerRef.current = setTimeout(() => {
      setDenomTip(null);
      denomTipHideTimerRef.current = null;
    }, 140);
  }, [clearDenomTipHideTimer]);

  useEffect(() => {
    setDenomTipPortalReady(true);
    return () => {
      clearDenomTipHideTimer();
      setDenomTip(null);
    };
  }, [clearDenomTipHideTimer]);

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

  useEffect(() => {
    setUsdSort("default");
    clearDenomTipHideTimer();
    setDenomTip(null);
  }, [from, to, granularity, clearDenomTipHideTimer]);

  /** Join bucket streams for aligned line charts (handles sparse edges). */
  const chartAllTxVsIbc = useMemo(() => {
    if (!data) return [];
    const tx = data.series?.txTotal ?? [];
    const ibc = data.series?.ibcCombinedCounts ?? [];
    const txM = new Map(tx.map((r) => [r.bucket, finiteN(Number(r.value))]));
    const ibcM = new Map(ibc.map((r) => [r.bucket, finiteN(Number(r.value))]));
    const keys = [...new Set([...txM.keys(), ...ibcM.keys()])].sort();
    return keys.map((bucket) => ({
      bucket,
      successfulTx: txM.get(bucket) ?? 0,
      ibcFlows: ibcM.get(bucket) ?? 0,
    }));
  }, [data]);

  const chartIbcTraffic = useMemo(() => {
    if (!data) return [];
    const o = data.series?.ibcOutboundMsgs ?? [];
    const i = data.series?.ibcInboundRecvFlows ?? [];
    const outM = new Map(o.map((r) => [r.bucket, finiteN(Number(r.value))]));
    const inM = new Map(i.map((r) => [r.bucket, finiteN(Number(r.value))]));
    const keys = [...new Set([...outM.keys(), ...inM.keys()])].sort();
    return keys.map((bucket) => ({
      bucket,
      out: outM.get(bucket) ?? 0,
      recv: inM.get(bucket) ?? 0,
    }));
  }, [data]);

  const chartSuccessRate = useMemo(() => {
    if (!data?.series) return [];
    return buildSuccessRateRows(data.series.txTotal ?? [], data.series.txFailed ?? []);
  }, [data]);

  const chartGasUtilization = useMemo(() => {
    if (!data?.series) return [];
    return buildGasUtilizationRows(
      data.series.gasUsed ?? [],
      data.series.gasWanted ?? [],
      data.series.blockGasLimit ?? []
    );
  }, [data]);

  const chartStakingGov = useMemo(() => {
    if (!data?.series?.stakingGov) return [];
    const sg = data.series.stakingGov;
    return buildStakingGovActivityRows({
      delegations: sg.delegations ?? [],
      undelegations: sg.undelegations ?? [],
      redelegations: sg.redelegations ?? [],
      govVotes: sg.govVotes ?? [],
      govProposals: sg.govProposals ?? [],
    });
  }, [data]);

  const chartOffersActivity = useMemo(
    () => buildOffersActivityRows(data?.offers?.categoriesOverTime ?? []),
    [data?.offers?.categoriesOverTime]
  );
  const hasOfferActivity = useMemo(
    () => chartOffersActivity.some((r) => r.automated + r.interactive + r.unknown > 0),
    [chartOffersActivity]
  );

  const offerValueRows = useMemo(() => {
    const v = data?.offers?.value;
    if (!v) return [];
    const usd = data?.offerValueUsd;
    const disp = data?.display;
    const denoms = [
      ...new Set([
        ...Object.keys(v.giveByDenom),
        ...Object.keys(v.wantByDenom),
        ...Object.keys(v.payoutByDenom),
      ]),
    ];
    return denoms
      .map((denom) => {
        const dec = disp?.metas[denom]?.decimals;
        const sym = disp?.metas[denom]?.displaySymbol || denom;
        const fmt = (atomic: string | undefined): string => {
          if (!atomic || !/^\d+$/.test(atomic) || atomic === "0") return "—";
          return typeof dec === "number" ? atomicToHumanString(atomic, dec) : atomic;
        };
        return {
          denom,
          symbol: sym,
          giveNative: fmt(v.giveByDenom[denom]),
          giveUsd: usd?.give.byDenom[denom] ?? null,
          wantNative: fmt(v.wantByDenom[denom]),
          wantUsd: usd?.want.byDenom[denom] ?? null,
          payoutNative: fmt(v.payoutByDenom[denom]),
          payoutUsd: usd?.payouts.byDenom[denom] ?? null,
        };
      })
      .sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
  }, [data?.offers?.value, data?.offerValueUsd, data?.display]);

  const chartConcentration = useMemo(() => data?.concentrationOverTime ?? [], [data]);
  const hasConcentrationTrend = useMemo(
    () =>
      chartConcentration.some(
        (p) => p.grossUsdHhi !== null || p.feesUsdHhi !== null
      ),
    [chartConcentration]
  );

  const valueHandledBreakdownRows = useMemo((): GrossMovementRow[] => {
    if (!data) return [];
    const tv = data.transferVolumeByDenom;
    const bc = data.bankCreditsVolumeByDenom;
    const denoms = [...new Set([...Object.keys(tv), ...Object.keys(bc)])];
    const disp = data.display;
    const mapped: GrossMovementRow[] = [];

    for (const denom of denoms) {
      const gRaw = tv[denom];
      const cRaw = bc[denom];
      const metaAmt = gRaw ?? cRaw ?? "0";
      const r = disp
        ? listRow(metaAmt, denom, disp)
        : { amountHuman: metaAmt, symbol: "", rawDenom: denom };
      const ticker = r.symbol || "—";
      const dec = disp?.metas[denom]?.decimals;

      let grossDisplay = "—";
      let grossUnknown = false;
      if (gRaw !== undefined && BigInt(gRaw) > BigInt(0)) {
        const gr = disp ? listRow(gRaw, denom, disp) : { amountHuman: gRaw, symbol: "", rawDenom: denom };
        grossUnknown = !gr.symbol;
        const rounded = formatNativeVolumeRounded(gRaw, dec);
        grossDisplay = rounded ?? gr.amountHuman;
      }

      let creditsDisplay = "—";
      let creditsUnknown = false;
      if (cRaw !== undefined && BigInt(cRaw) > BigInt(0)) {
        const cr = disp ? listRow(cRaw, denom, disp) : { amountHuman: cRaw, symbol: "", rawDenom: denom };
        creditsUnknown = !cr.symbol;
        const rounded = formatNativeVolumeRounded(cRaw, dec);
        creditsDisplay = rounded ?? cr.amountHuman;
      }

      const grossUsd =
        gRaw !== undefined && BigInt(gRaw) > BigInt(0)
          ? (data.transferVolumeUsdByDenom[denom] ?? null)
          : null;
      const creditsUsd =
        cRaw !== undefined && BigInt(cRaw) > BigInt(0)
          ? (data.bankCreditsVolumeUsdByDenom[denom] ?? null)
          : null;

      mapped.push({
        key: denom,
        denom,
        ticker,
        grossDisplay,
        grossUnknown,
        usd: grossUsd,
        creditsDisplay,
        creditsUnknown,
        creditsUsd,
      });
    }
    return sortGrossMovementRows(mapped, usdSort);
  }, [data, usdSort]);

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

  const concentrationTimeAxis = useMemo(() => {
    const n = chartConcentration.length;
    const dense = n > 31;
    return {
      dataKey: "day" as const,
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
  }, [chartConcentration]);

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
        <p className="text-left text-xs font-bold text-[var(--color-text-secondary)]">
          Last indexed block height:{" "}
          <code className="font-bold text-[var(--accent)]">{data.indexer.lastIndexedHeight}</code>
          {data.indexer.updatedAt && (
            <span className="ml-2 font-bold">
              (indexer updated {new Date(data.indexer.updatedAt).toLocaleString()})
            </span>
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
          No rows in <code className="text-[var(--accent)]">hourly_metrics</code> for this range; the API
          fell back to <strong className="font-medium text-[var(--color-text-primary)]">daily</strong>{" "}
          rollups so values are not all zero. For a true hourly breakdown, ensure the indexer has written
          hourly data (same DB; re-index or catch up if this table was never filled).
        </p>
      )}

      <section
        id={dashboardSectionIds.filters}
        className="scroll-mt-6 flex flex-wrap items-end gap-4 rounded-lg border border-[var(--border)] bg-[var(--color-bg-control)] p-5 shadow-[var(--shadow-card)]"
      >
        <div className="flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-3 border-b border-[var(--border)]/60 pb-4">
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
          <div className="flex min-h-0 min-w-0 flex-wrap items-center justify-center gap-2">
            <span className="mr-1 text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
              Date range
            </span>
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
        <p className="w-full text-center text-xs leading-[1.4] text-[var(--muted)]">
          <span className="font-bold">
            Indexed rollups and participation metrics start{" "}
            <time dateTime={INDEXED_HISTORY_FROM_DAY}>{INDEXED_HISTORY_FROM_DAY}</time> UTC.
          </span>{" "}
          The API clamps <strong className="font-medium text-[var(--color-text-secondary)]">From</strong> to
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
          <MetricsFailureSetupHint />
        </div>
      )}

      {loading && !data && !err && (
        <p className="text-[var(--muted)]">Loading metrics…</p>
      )}

      {data && data.kpis && (
        <>
          <section id={dashboardSectionIds.valueHandled} className="scroll-mt-6 min-w-0 space-y-6">
            <h2 className={SECTION_HEADING_CLASS}>Value handled</h2>
            <p className={SECTION_INTRO_CLASS}>
              Native-denom amounts moved inside indexed transactions on agoric-3.{" "}
              <IndexerScopeCaveatInline />
            </p>
            <div className="w-full min-w-0 space-y-6">
              <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
                <h3 className={IN_CARD_TITLE_CLASS}>
                  Value by denom: gross in-tx vs bank credits (range total)
                </h3>
                <p className="mb-3 text-xs leading-snug text-[var(--muted)]">
                  One row per on-chain denom. <strong className="font-medium text-[var(--color-text-secondary)]">Gross in-tx</strong> is{" "}
                  <code className="text-[var(--accent)]">transfer_volume</code> + indexed IBC receive (same basis as Value Flow Map gross).{" "}
                  <strong className="font-medium text-[var(--color-text-secondary)]">Bank credits</strong> is{" "}
                  <code className="text-[var(--accent)]">coin_received</code> to non-module receivers (
                  <code className="text-[var(--accent)]">bank_credits_volume</code>). The two native columns often overlap the same settlement —{" "}
                  <strong className="font-medium text-[var(--color-text-secondary)]">do not add them</strong> or the two USD columns to infer a single
                  &quot;total value moved.&quot; USD estimates multiply each column&apos;s{" "}
                  <strong className="font-medium text-[var(--color-text-secondary)]">full-period native total</strong> by{" "}
                  <strong className="font-medium text-[var(--color-text-secondary)]">current CoinGecko spot USD</strong> — not a historical mark-to-market.
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
                      <col className="w-[9%]" />
                      <col className="w-[15%]" />
                      <col className="w-[15%]" />
                      <col className="w-[15%]" />
                      <col className="w-[15%]" />
                      <col className="w-[11%]" />
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
                          Gross in-tx
                        </th>
                        <th
                          scope="col"
                          className="px-1.5 py-2 text-right align-bottom font-semibold normal-case sm:px-2"
                          title="bank_credits_volume (coin_received to non-module receivers)"
                        >
                          Bank credits
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
                                ? "Sort by gross in-tx USD estimate, highest first"
                                : usdSort === "desc"
                                  ? "Sort by gross in-tx USD estimate, lowest first"
                                  : "Clear USD sort (ticker order)"
                            }
                          >
                            <span>USD gross (EST)</span>
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
                          className="px-1.5 py-2 text-right align-bottom font-semibold normal-case sm:px-2"
                          title="Same spot snapshot as gross; not additive with USD gross"
                        >
                          USD credits (EST)
                        </th>
                        <th
                          scope="col"
                          className="min-w-0 px-1.5 py-2 text-left align-bottom font-semibold normal-case sm:px-2"
                          title="Hover or focus View Denom in each row for the full on-chain denom string"
                        >
                          Denom
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {valueHandledBreakdownRows.map((row) => (
                        <tr
                          key={row.key}
                          className="border-b border-[var(--border)]/50 odd:bg-[var(--color-bg-primary)] even:bg-[var(--color-border)]"
                        >
                          <td className="max-w-0 min-w-0 overflow-x-auto whitespace-nowrap px-1.5 py-2 align-middle font-medium leading-tight text-[var(--text)] sm:px-2">
                            {row.ticker}
                          </td>
                          <td className="max-w-0 min-w-0 overflow-x-auto whitespace-nowrap px-1.5 py-2 text-right font-mono text-xs tabular-nums leading-tight sm:px-2 sm:text-sm">
                            {row.grossDisplay === "—" ? (
                              <span className="text-[var(--muted)]">—</span>
                            ) : row.grossUnknown ? (
                              <code className="text-xs text-amber-200/90">{row.grossDisplay}</code>
                            ) : (
                              <span className="text-[var(--text)]">{row.grossDisplay}</span>
                            )}
                          </td>
                          <td className="max-w-0 min-w-0 overflow-x-auto whitespace-nowrap px-1.5 py-2 text-right font-mono text-xs tabular-nums leading-tight sm:px-2 sm:text-sm">
                            {row.creditsDisplay === "—" ? (
                              <span className="text-[var(--muted)]">—</span>
                            ) : row.creditsUnknown ? (
                              <code className="text-xs text-amber-200/90">{row.creditsDisplay}</code>
                            ) : (
                              <span className="text-[var(--text)]">{row.creditsDisplay}</span>
                            )}
                          </td>
                          <td className="max-w-0 min-w-0 overflow-x-auto whitespace-nowrap px-1.5 py-2 text-right font-mono text-xs tabular-nums leading-tight text-[var(--text)] sm:px-2 sm:text-sm">
                            {row.usd ?? "—"}
                          </td>
                          <td className="max-w-0 min-w-0 overflow-x-auto whitespace-nowrap px-1.5 py-2 text-right font-mono text-xs tabular-nums leading-tight text-[var(--text)] sm:px-2 sm:text-sm">
                            {row.creditsUsd ?? "—"}
                          </td>
                          <td className="max-w-0 min-w-0 px-1.5 py-2 align-middle sm:px-2">
                            <button
                              type="button"
                              className="max-w-full cursor-help rounded-md border border-[var(--border)] bg-[color-mix(in_srgb,var(--color-bg-secondary)_88%,var(--surface))] px-1.5 py-1 text-left text-[10px] font-semibold leading-tight text-[var(--color-accent)] shadow-sm transition-colors hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-bg-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)] sm:px-2 sm:text-xs"
                              aria-label={`On-chain denom: ${row.denom}`}
                              title={row.denom}
                              onPointerEnter={(e) => showDenomTip(row.denom, e.currentTarget)}
                              onPointerLeave={scheduleHideDenomTip}
                              onFocus={(e) => showDenomTip(row.denom, e.currentTarget)}
                              onBlur={scheduleHideDenomTip}
                            >
                              View Denom
                            </button>
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
                        <td
                          className="px-1.5 py-3 text-center text-[var(--muted)] sm:px-2"
                          title="Not summed across assets"
                        >
                          —
                        </td>
                        <td
                          className="px-1.5 py-3 text-right font-mono tabular-nums sm:px-2"
                          title="Sum of per-asset gross USD (current spot); not additive with USD credits — do not treat like TVL"
                        >
                          {data.transferVolumeUsdTotal ?? "—"}
                        </td>
                        <td
                          className="px-1.5 py-3 text-right font-mono tabular-nums sm:px-2"
                          title="Sum of per-asset bank-credits USD (current spot); not additive with USD gross — overlapping bases"
                        >
                          {data.bankCreditsVolumeUsdTotal ?? "—"}
                        </td>
                        <td aria-hidden className="min-w-0 px-1.5 py-3 sm:px-2" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {denomTipPortalReady &&
                  denomTip &&
                  createPortal(
                    <div
                      role="tooltip"
                      className="pointer-events-auto fixed z-[9999] max-h-[min(70vh,24rem)] max-w-[min(28rem,calc(100vw-1rem))] overflow-y-auto whitespace-normal break-all rounded-md border border-[var(--border)] bg-[var(--color-surface)] px-2.5 py-2 font-mono text-[10px] leading-snug text-[var(--color-text-primary)] shadow-[0_8px_32px_rgba(0,0,0,0.45)] sm:text-xs"
                      style={{ left: denomTip.left, top: denomTip.top }}
                      onPointerEnter={clearDenomTipHideTimer}
                      onPointerLeave={scheduleHideDenomTip}
                    >
                      {denomTip.text}
                    </div>,
                    document.body
                  )}
              </div>
            </div>
            <ValueFlowMap data={data} />
          </section>

          <section id={dashboardSectionIds.gasFees} className="scroll-mt-6 space-y-4">
            <h2 className={SECTION_HEADING_CLASS}>Gas and fees</h2>
            <p className={SECTION_INTRO_CLASS}>
              KPI % change compares your selected range to an{" "}
              <strong className="font-medium text-[var(--color-text-secondary)]">equal-length prior window</strong>{" "}
              ending immediately before <strong className="font-medium text-[var(--color-text-secondary)]">From</strong>{" "}
              (UTC, same granularity). It is descriptive only — upgrades, price action, and traffic mix can differ between windows.{" "}
              <IndexerScopeCaveatInline />
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <KpiCard
                title="Gas used"
                subtitle={`ABCI gas units (successful + failed inclusions); not a token. ${INDEXER_SCOPE_CAVEAT_SUBTITLE}`}
                current={data.kpis.gasUsed.current}
                previous={data.kpis.gasUsed.previous}
                pct={data.kpis.gasUsed.pctChange}
              />
              <KpiCard
                title="Paid fees (uBLD → BLD)"
                subtitle={`Successful txs only · on-chain paid total in ${FEE_DENOM_UBLB} (shown as BLD). ${INDEXER_SCOPE_CAVEAT_SUBTITLE}`}
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
                title="Gas wanted"
                subtitle={`ABCI gas units requested (successful + failed). ${INDEXER_SCOPE_CAVEAT_SUBTITLE}`}
                current={data.kpis.gasWanted.current}
                previous={data.kpis.gasWanted.previous}
                pct={data.kpis.gasWanted.pctChange}
              />
              <KpiCardLite
                title="Gas efficiency"
                subtitle={`Gas used ÷ gas wanted (estimation tightness) · prior window: ${formatRatePct(data.kpis.gasEfficiencyPct.previous)}`}
                value={formatRatePct(data.kpis.gasEfficiencyPct.current)}
              />
              <KpiCardLite
                title="Block-space utilization (gas)"
                subtitle={`Gas used ÷ consensus block gas limit (max_gas) · prior window: ${formatRatePct(data.kpis.blockGasUtilizationPct.previous)}`}
                value={formatRatePct(data.kpis.blockGasUtilizationPct.current)}
              />
            </div>
            {chartGasUtilization.length > 0 && (
              <GasUtilizationLineChart data={chartGasUtilization} timeAxis={timeAxis} />
            )}
          </section>

          <section id={dashboardSectionIds.transactionActivity} className="scroll-mt-6 space-y-4">
            <h2 className={SECTION_HEADING_CLASS}>Transaction activity</h2>
            <p className={SECTION_INTRO_CLASS}>
              Successful txs are whole transactions (ABCI code 0). They are{" "}
              <strong className="font-medium text-[var(--color-text-secondary)]">not</strong> unique users or
              wallets — compare only to participation metrics below with that in mind. IBC KPIs count messages or inbound
              flows, not txs — see subtitles.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <KpiCard
                title="Successful txs"
                subtitle="Whole txs (ABCI 0), not unique addresses"
                current={data.kpis.txSuccess.current}
                previous={data.kpis.txSuccess.previous}
                pct={data.kpis.txSuccess.pctChange}
              />
              <KpiCard
                title="Failed txs"
                subtitle="Included but reverted (ABCI ≠ 0); consume gas, pay no fee_paid"
                current={data.kpis.txFailed.current}
                previous={data.kpis.txFailed.previous}
                pct={data.kpis.txFailed.pctChange}
              />
              <KpiCardLite
                title="Success rate"
                subtitle={`Share of aligned txs with ABCI code 0 · prior window: ${formatRatePct(data.kpis.successRatePct.previous)}`}
                value={formatRatePct(data.kpis.successRatePct.current)}
              />
              <KpiCard
                title="IBC outbound messages"
                subtitle="MsgTransfer count (several per tx possible)"
                current={data.kpis.ibcOutboundMsgCount.current}
                previous={data.kpis.ibcOutboundMsgCount.previous}
                pct={data.kpis.ibcOutboundMsgCount.pctChange}
              />
              <KpiCard
                title="IBC inbound (recv flows)"
                subtitle="Headline count: ibc_transfer_flow_in when indexed; else MsgRecvPacket msgs"
                current={data.kpis.ibcInboundRecvFlowCount.current}
                previous={data.kpis.ibcInboundRecvFlowCount.previous}
                pct={data.kpis.ibcInboundRecvFlowCount.pctChange}
              />
            </div>
            {data.normalizedRatios && (
              <>
                <h3 className={IN_CARD_TITLE_CLASS}>Normalized ratios (descriptive)</h3>
                <p className={SECTION_INTRO_CLASS}>
                  Denominator-aware views of the totals above — less sensitive to raw-count inflation. Active
                  address = distinct signer addresses in range; gas is divided by all included txs (success +
                  failed), fees and value by successful-tx and participation bases. USD uses current spot like
                  Value handled.
                </p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <KpiCardLite
                    title="Gas per tx"
                    subtitle="ABCI gas units per included tx (success + failed)"
                    value={data.normalizedRatios.gasPerTx}
                  />
                  <KpiCardLite
                    title="Fees per successful tx"
                    subtitle="Paid fees (uBLD → BLD) ÷ successful txs"
                    value={data.normalizedRatios.feeBldPerSuccessfulTx}
                  />
                  <KpiCardLite
                    title="Txs per active address"
                    subtitle="Successful txs ÷ distinct signer addresses (range)"
                    value={data.normalizedRatios.successfulTxsPerActiveAddress}
                  />
                  <KpiCardLite
                    title="Gross USD per active address"
                    subtitle="Gross-movement USD ÷ distinct signer addresses (range)"
                    value={data.normalizedRatios.grossUsdPerActiveAddress}
                  />
                </div>
              </>
            )}
            {chartSuccessRate.length > 0 && (
              <TxSuccessRateLineChart data={chartSuccessRate} timeAxis={timeAxis} />
            )}
          </section>

          <section id={dashboardSectionIds.volumeIbc} className="scroll-mt-6 space-y-3">
            <h2 className={SECTION_HEADING_CLASS}>Volume and IBC (time series)</h2>
            <p className={SECTION_INTRO_CLASS}>
              Activity counts only (successful txs vs outbound msgs + inbound recv-flow headline). Native token amounts live under Value handled. Series are agoric-3-local — see methodology for cross-chain interpretation.
            </p>
            <div className="space-y-8 lg:space-y-10">
              <AllTxVsIbcLineChart data={chartAllTxVsIbc} timeAxis={timeAxis} />
              <IbcTrafficLineChart data={chartIbcTraffic} timeAxis={timeAxis} />
            </div>
          </section>

          <section id={dashboardSectionIds.stakingGov} className="scroll-mt-6 space-y-4">
            <h2 className={SECTION_HEADING_CLASS}>Staking &amp; governance</h2>
            <p className={SECTION_INTRO_CLASS}>
              Message counts in successful txs (one message = one action), not token amounts or unique
              accounts. Top-level messages only — actions wrapped in authz <code>MsgExec</code> are not
              counted. KPI % change compares the selected range to an equal-length prior window.{" "}
              <IndexerScopeCaveatInline />
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <KpiCard
                title="Delegations"
                subtitle="MsgDelegate count"
                current={data.kpis.stakingDelegations.current}
                previous={data.kpis.stakingDelegations.previous}
                pct={data.kpis.stakingDelegations.pctChange}
              />
              <KpiCard
                title="Undelegations"
                subtitle="MsgUndelegate count"
                current={data.kpis.stakingUndelegations.current}
                previous={data.kpis.stakingUndelegations.previous}
                pct={data.kpis.stakingUndelegations.pctChange}
              />
              <KpiCard
                title="Redelegations"
                subtitle="MsgBeginRedelegate count"
                current={data.kpis.stakingRedelegations.current}
                previous={data.kpis.stakingRedelegations.previous}
                pct={data.kpis.stakingRedelegations.pctChange}
              />
              <KpiCard
                title="Governance votes"
                subtitle="MsgVote / MsgVoteWeighted (gov v1 + v1beta1)"
                current={data.kpis.govVotes.current}
                previous={data.kpis.govVotes.previous}
                pct={data.kpis.govVotes.pctChange}
              />
              <KpiCard
                title="Proposals submitted"
                subtitle="MsgSubmitProposal (gov v1 + v1beta1)"
                current={data.kpis.govProposals.current}
                previous={data.kpis.govProposals.previous}
                pct={data.kpis.govProposals.pctChange}
              />
            </div>
            {chartStakingGov.length > 0 && (
              <StakingGovActivityLineChart data={chartStakingGov} timeAxis={timeAxis} />
            )}
          </section>

          {data.offers && (
            <section id={dashboardSectionIds.offers} className="scroll-mt-6 space-y-4">
              <h2 className={SECTION_HEADING_CLASS}>SwingSet &amp; Zoe offers</h2>
              <p className={SECTION_INTRO_CLASS}>
                Agoric activity is mostly smart-wallet intent, not bare Cosmos messages. These count decoded{" "}
                <code>MsgWalletSpendAction</code>/<code>MsgWalletAction</code> actions — Zoe offers (
                <code>executeOffer</code>) and wallet invocations (<code>invokeEntry</code>).{" "}
                <strong className="font-medium text-[var(--color-text-secondary)]">
                  Action counts are not wallet counts
                </strong>{" "}
                — a few automation wallets dominate, so read them next to distinct submitting wallets.{" "}
                <IndexerScopeCaveatInline />
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <KpiCard
                  title="Wallet actions"
                  subtitle="Decoded MsgWallet(Spend)Action total (offers + invocations)"
                  current={data.offers.kpis.totalActions.current}
                  previous={data.offers.kpis.totalActions.previous}
                  pct={data.offers.kpis.totalActions.pctChange}
                />
                <KpiCardLite
                  title="Distinct submitting wallets (range)"
                  subtitle="Unique smart-wallet owners (offer_participant_day) · daily-grain · anti-overcounting signal"
                  value={String(data.offers.participants.distinctWallets)}
                />
                <KpiCard
                  title="Zoe offers"
                  subtitle="executeOffer / tryExitOffer actions"
                  current={data.offers.kpis.zoeOffers.current}
                  previous={data.offers.kpis.zoeOffers.previous}
                  pct={data.offers.kpis.zoeOffers.pctChange}
                />
                <KpiCard
                  title="Wallet invocations"
                  subtitle="invokeEntry actions (orchestration handlers)"
                  current={data.offers.kpis.walletInvocations.current}
                  previous={data.offers.kpis.walletInvocations.previous}
                  pct={data.offers.kpis.walletInvocations.pctChange}
                />
                <KpiCard
                  title="Automated actions"
                  subtitle="orchestration + oracle + fast-USDC categories"
                  current={data.offers.kpis.automatedActions.current}
                  previous={data.offers.kpis.automatedActions.previous}
                  pct={data.offers.kpis.automatedActions.pctChange}
                />
                <KpiCard
                  title="Interactive actions"
                  subtitle="vaults + PSM + auction + governance offers"
                  current={data.offers.kpis.interactiveActions.current}
                  previous={data.offers.kpis.interactiveActions.previous}
                  pct={data.offers.kpis.interactiveActions.pctChange}
                />
              </div>
              {hasOfferActivity && (
                <OffersActivityLineChart data={chartOffersActivity} timeAxis={timeAxis} />
              )}
              <h3 className={IN_CARD_TITLE_CLASS}>Settled Zoe offer outcomes</h3>
              <p className={SECTION_INTRO_CLASS}>
                Outcomes settle asynchronously after the offer tx, so these are self-indexed from vstorage{" "}
                <code>published.wallet.&lt;addr&gt;</code> <code>offerStatus</code> updates (block events), counted
                once per offer at its terminal payout. They cover Zoe offers (<code>executeOffer</code>), not{" "}
                <code>invokeEntry</code> invocations.
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <KpiCard
                  title="Settled offers"
                  subtitle="Zoe offers reaching terminal payout in range"
                  current={data.offers.outcomes.settled.current}
                  previous={data.offers.outcomes.settled.previous}
                  pct={data.offers.outcomes.settled.pctChange}
                />
                <KpiCardLite
                  title="Satisfaction rate"
                  subtitle="Share of settled offers with wants satisfied (numWantsSatisfied ≥ 1)"
                  value={formatRatePct(data.offers.outcomes.satisfactionRatePct)}
                />
                <KpiCard
                  title="Wants satisfied"
                  subtitle="Settled with numWantsSatisfied ≥ 1"
                  current={data.offers.outcomes.wantsSatisfied.current}
                  previous={data.offers.outcomes.wantsSatisfied.previous}
                  pct={data.offers.outcomes.wantsSatisfied.pctChange}
                />
                <KpiCard
                  title="Refunded / unsatisfied"
                  subtitle="Settled with numWantsSatisfied === 0 (give refunded)"
                  current={data.offers.outcomes.wantsUnsatisfied.current}
                  previous={data.offers.outcomes.wantsUnsatisfied.previous}
                  pct={data.offers.outcomes.wantsUnsatisfied.pctChange}
                />
                <KpiCard
                  title="Errored"
                  subtitle="Settled status carrying an error"
                  current={data.offers.outcomes.errored.current}
                  previous={data.offers.outcomes.errored.previous}
                  pct={data.offers.outcomes.errored.pctChange}
                />
              </div>
              {offerValueRows.length > 0 && (
                <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
                  <h3 className={IN_CARD_TITLE_CLASS}>Offer value by asset (give / want / payouts)</h3>
                  <p className="mb-3 text-xs leading-snug text-[var(--muted)]">
                    Native totals summed across offers, by vbank asset.{" "}
                    <strong className="font-medium text-[var(--color-text-secondary)]">Give</strong> /{" "}
                    <strong className="font-medium text-[var(--color-text-secondary)]">Want</strong> are offer
                    intent (escrowed / requested);{" "}
                    <strong className="font-medium text-[var(--color-text-secondary)]">Payouts</strong> is what
                    settled offers returned. These overlap (give is refunded into payouts) —{" "}
                    <strong className="font-medium text-[var(--color-text-secondary)]">do not add the columns.</strong>{" "}
                    USD (EST) multiplies each native total by current CoinGecko spot (gross flow, not net or TVL);
                    only vbank-recognized assets are valued.
                    {data.offerValueUsd?.usdPricingMeta.spotFetchedAt && (
                      <span>
                        {" "}
                        Spot snapshot:{" "}
                        <time dateTime={data.offerValueUsd.usdPricingMeta.spotFetchedAt}>
                          {new Date(data.offerValueUsd.usdPricingMeta.spotFetchedAt).toLocaleString()}
                        </time>
                        .
                      </span>
                    )}
                  </p>
                  <div className="min-w-0 max-w-full overflow-x-auto">
                    <table className="w-full min-w-0 border-collapse text-xs sm:text-sm">
                      <thead>
                        <tr className="bg-[var(--color-bg-secondary)] text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]/55 sm:text-xs">
                          <th scope="col" className="px-2 py-2 text-left font-semibold normal-case">Asset</th>
                          <th scope="col" className="px-2 py-2 text-right font-semibold normal-case">Give</th>
                          <th scope="col" className="px-2 py-2 text-right font-semibold normal-case">Give USD</th>
                          <th scope="col" className="px-2 py-2 text-right font-semibold normal-case">Want</th>
                          <th scope="col" className="px-2 py-2 text-right font-semibold normal-case">Want USD</th>
                          <th scope="col" className="px-2 py-2 text-right font-semibold normal-case">Payouts</th>
                          <th scope="col" className="px-2 py-2 text-right font-semibold normal-case">Payouts USD</th>
                        </tr>
                      </thead>
                      <tbody>
                        {offerValueRows.map((r) => (
                          <tr
                            key={r.denom}
                            className="border-b border-[var(--border)]/50 odd:bg-[var(--color-bg-primary)] even:bg-[var(--color-border)]"
                          >
                            <td className="px-2 py-2 align-middle font-medium text-[var(--text)]">{r.symbol}</td>
                            <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text)]">{r.giveNative}</td>
                            <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text)]">{r.giveUsd ?? "—"}</td>
                            <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text)]">{r.wantNative}</td>
                            <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text)]">{r.wantUsd ?? "—"}</td>
                            <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text)]">{r.payoutNative}</td>
                            <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text)]">{r.payoutUsd ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-[var(--border)] text-xs font-semibold text-[var(--color-text-primary)] sm:text-sm">
                          <td className="px-2 py-3 text-[var(--color-accent)]">TOTAL USD</td>
                          <td className="px-2 py-3 text-center text-[var(--muted)]" title="Not summed across assets">—</td>
                          <td className="px-2 py-3 text-right font-mono tabular-nums">{data.offerValueUsd?.give.total ?? "—"}</td>
                          <td className="px-2 py-3 text-center text-[var(--muted)]" title="Not summed across assets">—</td>
                          <td className="px-2 py-3 text-right font-mono tabular-nums">{data.offerValueUsd?.want.total ?? "—"}</td>
                          <td className="px-2 py-3 text-center text-[var(--muted)]" title="Not summed across assets">—</td>
                          <td className="px-2 py-3 text-right font-mono tabular-nums">{data.offerValueUsd?.payouts.total ?? "—"}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}
              <div className="grid gap-6 lg:grid-cols-2">
                <OfferCategoryTable rows={data.offers.byCategory} />
                <OfferLabeledTable
                  title="By target contract (instance)"
                  hint="Zoe offers by target Instance; Board ids resolved to agoricNames labels."
                  colLabel="Contract"
                  rows={data.offers.byInstance}
                />
                <OfferLabeledTable
                  title="By invocation target"
                  hint="invokeEntry handler name (e.g. planner, evmWalletHandler)."
                  colLabel="Target"
                  rows={data.offers.byTarget}
                />
                <OfferLabeledTable
                  title="By invitation maker"
                  hint="Invitation maker used (publicInvitationMaker / invitationMakerName / first callPipe entry)."
                  colLabel="Maker"
                  rows={data.offers.byMaker}
                />
              </div>
            </section>
          )}

          {(data.participation || data.concentration) && (
            <section id={dashboardSectionIds.participation} className="scroll-mt-6 space-y-4">
              <h2 className={SECTION_HEADING_CLASS}>Economic participation &amp; concentration</h2>
              <p className={SECTION_INTRO_CLASS}>
                On-chain accounts, not people — signers (all pubkeys in the tx) and fee payers are counted separately; distinct lines dedupe per day across roles. Bots, vaults, relayers, and contracts count like any account.{" "}
                <strong className="font-medium text-[var(--color-text-secondary)]">
                  Do not rank or ratio these counts against successful tx totals without normalization
                </strong>{" "}
                — one address can authorize many txs per day. Top-10 gross share: USD spot on sender-side transfer legs only (same spot caveat as Value handled) — see methodology.{" "}
                <IndexerScopeCaveatInline />
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
                    <KpiCardLite
                      title="Distinct signers (range)"
                      subtitle="Unique signer addresses (multi-signer txs count each pubkey)"
                      value={data.participation.distinctSigners}
                    />
                    <KpiCardLite
                      title="Distinct fee payers (range)"
                      subtitle="Unique resolved fee payers — not deduped vs signers"
                      value={data.participation.distinctFeePayers}
                    />
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
                  <>
                    <KpiCardLite
                      title="Top 10 addresses — gross USD share"
                      subtitle="Sender-attributed transfer legs · USD uses current spot like Value handled"
                      value={data.concentration.top10AddressShareGrossUsd ?? "—"}
                    />
                    <KpiCardLite
                      title="Top 10 fee payers — fee USD share"
                      subtitle="Paid fees by resolved fee payer · costliest signal, hardest to wash"
                      value={data.concentration.top10AddressShareFeesUsd ?? "—"}
                    />
                    <KpiCardLite
                      title="Gross USD HHI (0–1)"
                      subtitle="Herfindahl index of per-address gross USD; higher = more concentrated"
                      value={data.concentration.grossUsdHhi ?? "—"}
                    />
                    <KpiCardLite
                      title="Fee USD HHI (0–1)"
                      subtitle="Herfindahl index of per-fee-payer fee USD; higher = more concentrated"
                      value={data.concentration.feesUsdHhi ?? "—"}
                    />
                  </>
                )}
              </div>
              {hasConcentrationTrend && (
                <ConcentrationLineChart
                  data={chartConcentration}
                  timeAxis={concentrationTimeAxis}
                />
              )}
              {data.participation &&
                data.participation.distinctUnionPerDay &&
                data.participation.distinctUnionPerDay.length > 0 && (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
                    <h3 className={IN_CARD_TITLE_CLASS}>Distinct account addresses per calendar day</h3>
                    <p className="mb-3 text-xs leading-snug text-[var(--muted)]">
                      Daily union of signer ∪ fee payer for successful txs (deduped that day). Unlike successful-tx counts,
                      each address is counted at most once per UTC day — many txs can still map to one row in this table.
                    </p>
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
        {methodologyOpen && <MethodologyPanel sections={METHODOLOGY_SECTIONS} />}
      </footer>
    </div>
  );
}

/**
 * Renders {@link INDEXER_SCOPE_CAVEAT_INLINE} with the literal word "Methodology" linked to the
 * dashboard's methodology footer anchor (`dashboardSectionIds.methodology`). The caveat string in
 * `semantics.ts` stays the source of truth so wording cannot drift between surfaces.
 */
function IndexerScopeCaveatInline() {
  const parts = INDEXER_SCOPE_CAVEAT_INLINE.split("Methodology");
  if (parts.length !== 2) return <>{INDEXER_SCOPE_CAVEAT_INLINE}</>;
  const [before, after] = parts;
  return (
    <>
      {before}
      <a
        href={`#${dashboardSectionIds.methodology}`}
        className="underline decoration-dotted underline-offset-2 hover:text-[var(--accent)]"
      >
        Methodology
      </a>
      {after}
    </>
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
        Prior window (equal length): <span className="font-mono text-[var(--text)]">{previous}</span>
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

const AUTOMATION_LABEL: Record<string, string> = {
  automated: "Automated",
  interactive: "Interactive",
  unknown: "Uncategorized",
};

const OFFER_TABLE_WRAP =
  "rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5";

function OfferEmpty() {
  return (
    <p className="text-xs text-[var(--muted)]">
      No wallet actions in range. Offer rollups populate as the indexer processes blocks (full backfill on
      next reindex).
    </p>
  );
}

function OfferCategoryTable({
  rows,
}: {
  rows: { category: string; automation: string; count: string }[];
}) {
  return (
    <div className={OFFER_TABLE_WRAP}>
      <h3 className={IN_CARD_TITLE_CLASS}>By functional category</h3>
      <p className="mb-3 text-xs leading-snug text-[var(--muted)]">
        Exactly one objective category per action (additive, non-overlapping). Class is the read-time
        automated-vs-interactive grouping.
      </p>
      {rows.length === 0 ? (
        <OfferEmpty />
      ) : (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full border-collapse text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[var(--color-accent)]">
                <th className="py-2 pr-4 font-semibold">Category</th>
                <th className="py-2 pr-4 font-semibold">Class</th>
                <th className="py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.category} className="border-b border-[var(--border)]/40">
                  <td className="py-1.5 pr-4 font-mono text-[var(--text)]">{r.category}</td>
                  <td className="py-1.5 pr-4 text-[var(--muted)]">
                    {AUTOMATION_LABEL[r.automation] ?? r.automation}
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-[var(--text)]">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OfferLabeledTable({
  title,
  hint,
  colLabel,
  rows,
}: {
  title: string;
  hint: string;
  colLabel: string;
  rows: OfferLabeledCount[];
}) {
  return (
    <div className={OFFER_TABLE_WRAP}>
      <h3 className={IN_CARD_TITLE_CLASS}>{title}</h3>
      <p className="mb-3 text-xs leading-snug text-[var(--muted)]">{hint}</p>
      {rows.length === 0 ? (
        <OfferEmpty />
      ) : (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full border-collapse text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[var(--color-accent)]">
                <th className="py-2 pr-4 font-semibold">{colLabel}</th>
                <th className="py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-[var(--border)]/40">
                  <td className="py-1.5 pr-4 font-mono text-[var(--text)] break-all">{r.label}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-[var(--text)]">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
