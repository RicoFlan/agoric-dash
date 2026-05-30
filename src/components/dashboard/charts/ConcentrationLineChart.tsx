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
import type { ConcentrationTimePoint } from "@/lib/concentrationTimeseries";
import { linearTrendLine } from "@/lib/linearTrend";
import { filterNonZeroTooltipPayload } from "@/lib/rechartsTooltip";

type XAxisSpread = ComponentProps<typeof XAxis>;

/** dataKeys whose values are HHI (0–1); everything else in this chart is a percentage (0–100). */
const HHI_KEYS = new Set(["grossUsdHhi", "feesUsdHhi", "feesUsdHhiTrend"]);

export default function ConcentrationLineChart({
  data,
  timeAxis,
}: {
  data: ConcentrationTimePoint[];
  timeAxis: XAxisSpread;
}) {
  const rows = useMemo(() => {
    const feesHhiTrend = linearTrendLine(data.map((d) => d.feesUsdHhi ?? NaN));
    return data.map((row, i) => ({ ...row, feesUsdHhiTrend: feesHhiTrend[i]! }));
  }, [data]);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h3 className="mb-3 border-b border-[var(--border)] pb-2 text-lg font-semibold leading-tight text-[var(--color-text-primary)]">
        Concentration over time (HHI &amp; top-10 share)
      </h3>
      <p className="mb-4 text-xs leading-[1.4] text-[var(--muted)]">
        Daily Herfindahl–Hirschman index (left, 0–1) and top-10 address share (right, %) of
        gross-movement USD and paid-fee USD, priced at current spot. Higher = more concentrated. Fees
        are the most wash/Sybil-resistant lens (faking fee breadth costs real money). Daily-grain
        regardless of the selected granularity; gaps mark days without priced activity. Dashed line is
        the OLS trend of fee HHI.
      </p>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
            <XAxis {...timeAxis} />
            <YAxis
              yAxisId="hhi"
              domain={[0, 1]}
              tick={{ fill: chartTheme.axisTick, fontSize: 11 }}
              tickFormatter={(v) => Number(v).toFixed(2)}
            />
            <YAxis
              yAxisId="share"
              orientation="right"
              domain={[0, 100]}
              tick={{ fill: chartTheme.axisTick, fontSize: 11 }}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              content={({ active, label, payload }) => {
                const filtered = filterNonZeroTooltipPayload(payload);
                if (!active || !filtered.length) return null;
                return (
                  <div
                    className="rounded-md border p-2 text-xs"
                    style={{ borderColor: chartTheme.tooltipBorder, background: chartTheme.tooltipBg }}
                  >
                    <p style={{ color: chartTheme.tooltipMuted }}>{String(label)}</p>
                    {filtered.map((e, i) => {
                      const isHhi = HHI_KEYS.has(String(e.dataKey ?? ""));
                      const val =
                        typeof e.value === "number"
                          ? isHhi
                            ? e.value.toFixed(3)
                            : `${e.value.toFixed(1)}%`
                          : String(e.value ?? "");
                      return (
                        <p key={i} style={{ color: chartTheme.tooltipText }}>
                          {String(e.name ?? "")}: {val}
                        </p>
                      );
                    })}
                  </div>
                );
              }}
            />
            <Legend />
            <Line
              yAxisId="hhi"
              type="monotone"
              dataKey="feesUsdHhi"
              name="Fee USD HHI"
              stroke={chartTheme.lineA}
              dot={false}
              connectNulls={false}
            />
            <Line
              yAxisId="hhi"
              type="monotone"
              dataKey="grossUsdHhi"
              name="Gross USD HHI"
              stroke={chartTheme.lineB}
              dot={false}
              connectNulls={false}
            />
            <Line
              yAxisId="share"
              type="monotone"
              dataKey="top10ShareFeesUsdPct"
              name="Top-10 fee share %"
              stroke={chartTheme.lineE}
              dot={false}
              connectNulls={false}
            />
            <Line
              yAxisId="share"
              type="monotone"
              dataKey="top10ShareGrossUsdPct"
              name="Top-10 gross share %"
              stroke={chartTheme.lineC}
              dot={false}
              connectNulls={false}
            />
            <Line
              yAxisId="hhi"
              type="monotone"
              dataKey="feesUsdHhiTrend"
              name="Fee USD HHI (trend)"
              stroke={chartTheme.lineA}
              dot={false}
              strokeOpacity={0.85}
              {...chartTheme.trendLineProps}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
