"use client";

import type { ComponentProps } from "react";
import type { EnrichedDisplay } from "@/lib/metricsDisplayTypes";
import { atomicToFloat, atomicToHumanString } from "@/lib/amountFormat";
import { parseUsdEstimateSortKey } from "@/lib/grossTableUsdSort";
import { chartTheme } from "@/lib/chartTheme";
import { buildValueFlowMiniRows } from "@/lib/valueFlowMapSeries";
import ValueFlowMapMiniCharts from "@/components/dashboard/ValueFlowMapMiniCharts";
import { useEffect, useMemo, useState } from "react";

type XAxisSpread = ComponentProps<import("recharts").XAxis>;

type BucketPoint = { bucket: string; value: string };

type SeriesByDenom = {
  denom: string;
  data: BucketPoint[];
};

export type ValueFlowMapPayload = {
  granularity?: "hour" | "day" | "week";
  range: { from: string; to: string };
  display?: EnrichedDisplay;
  transferVolumeByDenom: Record<string, string>;
  bankCreditsVolumeByDenom: Record<string, string>;
  transferVolumeUsdByDenom: Record<string, string | null>;
  bankCreditsVolumeUsdByDenom: Record<string, string | null>;
  series: {
    transferVolumeSeries: SeriesByDenom[];
    bankCreditsVolumeSeries: SeriesByDenom[];
    ibcAmountInSeries: SeriesByDenom[];
    ibcAmountOutSeries: SeriesByDenom[];
  };
};

function formatNativeVolumeRounded(atomic: string, decimals: number | undefined): string | null {
  if (typeof decimals !== "number" || !Number.isFinite(decimals) || decimals < 0) return null;
  const n = atomicToFloat(atomic, decimals);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatNativeHuman(atomic: string, decimals: number | undefined): string {
  if (typeof decimals !== "number" || !Number.isFinite(decimals) || decimals < 0) return atomic;
  return atomicToHumanString(atomic, decimals);
}

function pctChangeAtomicWithinRange(firstAtomic: string, lastAtomic: string): number | null {
  const f = /^\d+$/.test(firstAtomic) ? BigInt(firstAtomic) : 0n;
  const l = /^\d+$/.test(lastAtomic) ? BigInt(lastAtomic) : 0n;
  if (f === 0n) return l === 0n ? 0 : null;
  const scaled = ((l - f) * 10000n) / f; // 2 decimals of pct
  return Number(scaled) / 100;
}

function sumSeriesAtomic(points: BucketPoint[] | undefined): bigint {
  if (!points || points.length === 0) return 0n;
  let t = 0n;
  for (const p of points) {
    if (/^\d+$/.test(p.value)) t += BigInt(p.value);
  }
  return t;
}

function getSeriesForDenom(series: SeriesByDenom[], denom: string): BucketPoint[] | undefined {
  return series.find((s) => s.denom === denom)?.data;
}

function pctChip(pct: number | null): string {
  if (pct === null) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function formatBucketTick(v: string, g: "hour" | "day" | "week") {
  if (g === "hour") {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return v;
    return `${(d.getUTCMonth() + 1).toString().padStart(2, "0")}/${d.getUTCDate().toString().padStart(2, "0")} ${d.getUTCHours().toString().padStart(2, "0")}:00`;
  }
  return v.slice(0, 10);
}

export default function ValueFlowMap({ data }: { data: ValueFlowMapPayload }) {
  const granularity = data.granularity ?? "day";
  const denoms = useMemo(() => Object.keys(data.transferVolumeByDenom ?? {}), [data.transferVolumeByDenom]);

  const defaultDenom = useMemo(() => {
    if (denoms.length === 0) return null;

    const ranked = denoms
      .map((d) => {
        const usd = data.transferVolumeUsdByDenom[d] ?? null;
        const usdKey = parseUsdEstimateSortKey(usd);
        const grossAtomic = data.transferVolumeByDenom[d] ?? "0";
        const grossBig = /^\d+$/.test(grossAtomic) ? BigInt(grossAtomic) : 0n;
        return { denom: d, usdKey, grossBig };
      })
      .sort((a, b) => {
        const aMiss = !Number.isFinite(a.usdKey);
        const bMiss = !Number.isFinite(b.usdKey);
        if (aMiss && bMiss) {
          if (a.grossBig === b.grossBig) return a.denom.localeCompare(b.denom);
          // Descending by gross native amount when USD is missing.
          return a.grossBig > b.grossBig ? -1 : 1;
        }
        if (aMiss) return 1;
        if (bMiss) return -1;
        if (a.usdKey !== b.usdKey) return b.usdKey - a.usdKey;
        if (a.grossBig === b.grossBig) return a.denom.localeCompare(b.denom);
        return a.grossBig > b.grossBig ? -1 : 1;
      });

    return ranked[0]?.denom ?? null;
  }, [data.transferVolumeByDenom, data.transferVolumeUsdByDenom, denoms]);

  const [selectedDenom, setSelectedDenom] = useState<string | null>(defaultDenom);

  // When the dataset changes (new range), re-seed selection.
  useEffect(() => {
    setSelectedDenom(defaultDenom);
  }, [defaultDenom]);

  const denomView = useMemo(() => {
    if (!selectedDenom) return null;
    const dispMeta = data.display?.metas[selectedDenom];
    const decimals = dispMeta?.decimals;
    const displaySymbol = dispMeta?.displaySymbol ?? null;

    const grossAtomic = data.transferVolumeByDenom[selectedDenom] ?? "0";
    const creditsAtomic = data.bankCreditsVolumeByDenom[selectedDenom] ?? "0";

    const grossSeries = getSeriesForDenom(data.series.transferVolumeSeries, selectedDenom);
    const creditsSeries = getSeriesForDenom(data.series.bankCreditsVolumeSeries, selectedDenom);
    const ibcInSeries = getSeriesForDenom(data.series.ibcAmountInSeries, selectedDenom);
    const ibcOutSeries = getSeriesForDenom(data.series.ibcAmountOutSeries, selectedDenom);

    const grossFirst = grossSeries?.[0]?.value ?? "0";
    const grossLast = grossSeries?.[grossSeries.length - 1]?.value ?? "0";
    const creditsFirst = creditsSeries?.[0]?.value ?? "0";
    const creditsLast = creditsSeries?.[creditsSeries.length - 1]?.value ?? "0";
    const ibcInTotal = sumSeriesAtomic(ibcInSeries).toString();
    const ibcOutTotal = sumSeriesAtomic(ibcOutSeries).toString();

    const grossBig = /^\d+$/.test(grossAtomic) ? BigInt(grossAtomic) : 0n;
    const ibcInBig = /^\d+$/.test(ibcInTotal) ? BigInt(ibcInTotal) : 0n;
    const transferLikeBig = grossBig >= ibcInBig ? grossBig - ibcInBig : 0n;

    return {
      label: displaySymbol ?? selectedDenom,
      decimals,
      grossHumanRounded:
        formatNativeVolumeRounded(grossAtomic, decimals) ?? formatNativeHuman(grossAtomic, decimals),
      creditsHumanRounded:
        formatNativeVolumeRounded(creditsAtomic, decimals) ?? formatNativeHuman(creditsAtomic, decimals),
      transferLikeHumanRounded:
        formatNativeVolumeRounded(transferLikeBig.toString(), decimals) ??
        formatNativeHuman(transferLikeBig.toString(), decimals),
      ibcInHumanRounded:
        formatNativeVolumeRounded(ibcInTotal, decimals) ?? formatNativeHuman(ibcInTotal, decimals),
      ibcOutHumanRounded:
        formatNativeVolumeRounded(ibcOutTotal, decimals) ?? formatNativeHuman(ibcOutTotal, decimals),
      grossUsd: data.transferVolumeUsdByDenom[selectedDenom] ?? null,
      creditsUsd: data.bankCreditsVolumeUsdByDenom[selectedDenom] ?? null,
      grossMomentumPct: pctChangeAtomicWithinRange(grossFirst, grossLast),
      creditsMomentumPct: pctChangeAtomicWithinRange(creditsFirst, creditsLast),
      miniRows: buildValueFlowMiniRows(
        selectedDenom,
        grossSeries,
        creditsSeries,
        ibcInSeries,
        ibcOutSeries,
        data.display
      ),
    };
  }, [selectedDenom, data]);

  const timeAxis = useMemo((): XAxisSpread => {
    if (granularity === "hour") {
      return {
        dataKey: "bucket",
        tick: { fill: chartTheme.axisTick, fontSize: 8 },
        height: 36,
        angle: -28,
        textAnchor: "end",
        interval: "preserveStartEnd",
        minTickGap: 4,
        tickFormatter: (v: string) => formatBucketTick(v, granularity),
      };
    }
    return {
      dataKey: "bucket",
      tick: { fill: chartTheme.axisTick, fontSize: 9 },
      tickFormatter: (v: string) => formatBucketTick(v, granularity),
    };
  }, [granularity]);

  if (!selectedDenom || !denomView) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        <h3 className="mb-2 text-lg font-semibold text-[var(--color-text-primary)]">Value Flow Map</h3>
        <p className="text-xs text-[var(--muted)]">No value-flow data for the selected range.</p>
      </div>
    );
  }

  const {
    label,
    grossHumanRounded,
    creditsHumanRounded,
    transferLikeHumanRounded,
    ibcInHumanRounded,
    ibcOutHumanRounded,
    grossUsd,
    creditsUsd,
    grossMomentumPct,
    creditsMomentumPct,
    miniRows,
  } = denomView;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-[18rem]">
          <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">Value Flow Map</h3>
          <p className="mt-1 text-xs leading-snug text-[var(--muted)]">
            One asset at a time. Gross in-tx movement is composed of <strong>transfer-like legs</strong> plus{" "}
            <strong>IBC-in settlement</strong> (per denom). Credits is a separate, overlapping “credited to user addresses” view.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
            <span className="font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Select asset</span>
            <select
              value={selectedDenom}
              onChange={(e) => setSelectedDenom(e.target.value)}
              className="min-w-[14rem] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--text)]"
            >
              {denoms.map((d) => {
                const m = data.display?.metas[d];
                const sym = m?.displaySymbol ?? null;
                return (
                  <option key={d} value={d}>
                    {sym ?? d}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            Gross in-tx movement
          </p>
          <p className="mt-2 font-mono text-xl text-[var(--text)]">{grossHumanRounded}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            USD (EST): <span className="font-mono text-[var(--color-text-primary)]">{grossUsd ?? "—"}</span>
          </p>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Momentum (last vs first bucket): <span className="font-mono text-[var(--text)]">{pctChip(grossMomentumPct)}</span>
          </p>
        </div>

        <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            Transfer-like legs
          </p>
          <p className="mt-2 font-mono text-xl text-[var(--text)]">{transferLikeHumanRounded}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">Gross = transfer-like + IBC-in</p>
        </div>

        <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            IBC in (recv settlement)
          </p>
          <p className="mt-2 font-mono text-xl text-[var(--text)]">{ibcInHumanRounded}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">Summed from IBC-in amount series</p>
        </div>

        <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Bank credits</p>
          <p className="mt-2 font-mono text-xl text-[var(--text)]">{creditsHumanRounded}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            USD (EST): <span className="font-mono text-[var(--color-text-primary)]">{creditsUsd ?? "—"}</span>
          </p>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Momentum (last vs first bucket): <span className="font-mono text-[var(--text)]">{pctChip(creditsMomentumPct)}</span>
          </p>
        </div>

        <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-4 sm:col-span-2 lg:col-span-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            IBC out (outbound token)
          </p>
          <p className="mt-2 font-mono text-xl text-[var(--text)]">{ibcOutHumanRounded}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">Summed from IBC-out amount series</p>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Asset: <span className="font-mono text-[var(--text)]">{label}</span>
          </p>
        </div>
      </div>

      <ValueFlowMapMiniCharts rows={miniRows} timeAxis={timeAxis} assetLabel={label} />
    </div>
  );
}

