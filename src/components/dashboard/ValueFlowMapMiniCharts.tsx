"use client";

import type { ComponentProps } from "react";
import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "@/lib/chartTheme";
import { linearTrendLine } from "@/lib/linearTrend";
import { filterNonZeroTooltipPayload, formatTooltipNumber } from "@/lib/rechartsTooltip";
import type { ValueFlowMiniRow } from "@/lib/valueFlowMapSeries";

type XAxisSpread = ComponentProps<typeof XAxis>;

function MiniLineChart({
  title,
  caption,
  rows,
  timeAxis,
  series,
  heightClass = "h-44",
}: {
  title: string;
  caption: string;
  rows: ValueFlowMiniRow[];
  timeAxis: XAxisSpread;
  series: { dataKey: keyof ValueFlowMiniRow; name: string; stroke: string; strokeDasharray?: string }[];
  heightClass?: string;
}) {
  const rowsWithTrends = useMemo(() => {
    const trendByKey = new Map<string, number[]>();
    for (const s of series) {
      trendByKey.set(
        String(s.dataKey),
        linearTrendLine(rows.map((r) => Number(r[s.dataKey])))
      );
    }
    return rows.map((r, i) => {
      const next: Record<string, number> = {};
      for (const s of series) {
        next[`${String(s.dataKey)}Trend`] = trendByKey.get(String(s.dataKey))?.[i] ?? 0;
      }
      return { ...r, ...next };
    });
  }, [rows, series]);

  const hasAny = rows.some((r) => series.some((s) => Number(r[s.dataKey]) > 0));
  if (!hasAny) {
    return (
      <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{title}</p>
        <p className="mt-2 text-xs text-[var(--muted)]">No bucket activity in this range.</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{title}</p>
      <p className="mt-1 text-xs leading-snug text-[var(--muted)]">{caption}</p>
      <div className={`mt-3 w-full ${heightClass}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rowsWithTrends} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
            <XAxis {...timeAxis} />
            <YAxis tick={{ fill: chartTheme.axisTick, fontSize: 9 }} width={44} />
            <Tooltip
              content={({ active, label, payload }) => {
                const filtered = filterNonZeroTooltipPayload(payload);
                if (!active || !filtered.length) return null;
                return (
                  <div
                    className="rounded-md border p-2 text-xs"
                    style={{
                      borderColor: chartTheme.tooltipBorder,
                      background: chartTheme.tooltipBg,
                    }}
                  >
                    <p style={{ color: chartTheme.tooltipMuted }}>{String(label)}</p>
                    {filtered.map((e, i) => (
                      <p key={i} style={{ color: chartTheme.tooltipText }}>
                        {String(e.name ?? "")}: {formatTooltipNumber(e.value)}
                      </p>
                    ))}
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 9, paddingTop: 4 }} />
            {series.map((s) => (
              <Line
                key={s.dataKey}
                type="monotone"
                dataKey={s.dataKey}
                name={s.name}
                stroke={s.stroke}
                strokeDasharray={s.strokeDasharray}
                dot={false}
                strokeWidth={1.5}
              />
            ))}
            {series.map((s) => (
              <Line
                key={`${String(s.dataKey)}Trend`}
                type="monotone"
                dataKey={`${String(s.dataKey)}Trend`}
                name={`${s.name} (trend)`}
                stroke={s.stroke}
                dot={false}
                strokeOpacity={0.85}
                {...chartTheme.trendLineProps}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function ValueFlowMapMiniCharts({
  rows,
  timeAxis,
  assetLabel,
}: {
  rows: ValueFlowMiniRow[];
  timeAxis: XAxisSpread;
  assetLabel: string;
}) {
  const grossSeries = useMemo(
    () => [
      { dataKey: "gross" as const, name: "Gross in-tx", stroke: chartTheme.lineA },
      { dataKey: "transferLike" as const, name: "Transfer-like", stroke: chartTheme.lineB, strokeDasharray: "4 3" },
      { dataKey: "ibcIn" as const, name: "IBC in", stroke: chartTheme.lineC, strokeDasharray: "6 4" },
    ],
    []
  );

  const creditsSeries = useMemo(
    () => [
      { dataKey: "credits" as const, name: "Bank credits", stroke: chartTheme.lineD },
      { dataKey: "ibcOut" as const, name: "IBC out", stroke: chartTheme.lineE, strokeDasharray: "6 4" },
    ],
    []
  );

  return (
    <div className="mt-6 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-accent)]">
        Over time — {assetLabel}
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <MiniLineChart
          title="Gross composition"
          caption="Gross = transfer-like + IBC-in per bucket (human units when mapped)."
          rows={rows}
          timeAxis={timeAxis}
          series={grossSeries}
        />
        <MiniLineChart
          title="Credits vs outbound IBC"
          caption="Overlapping views — not additive with gross."
          rows={rows}
          timeAxis={timeAxis}
          series={creditsSeries}
        />
      </div>
    </div>
  );
}
