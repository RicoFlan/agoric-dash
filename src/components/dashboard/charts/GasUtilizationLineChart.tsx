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
import type { GasUtilizationRow } from "@/lib/gasUtilizationSeries";
import { filterNonZeroTooltipPayload } from "@/lib/rechartsTooltip";

type XAxisSpread = ComponentProps<typeof XAxis>;

export default function GasUtilizationLineChart({
  data,
  timeAxis,
}: {
  data: GasUtilizationRow[];
  timeAxis: XAxisSpread;
}) {
  const rows = useMemo(() => {
    const utilTrend = linearTrendLine(data.map((d) => d.blockGasUtilizationPct ?? NaN));
    return data.map((row, i) => ({ ...row, blockGasUtilizationPctTrend: utilTrend[i]! }));
  }, [data]);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h3 className="mb-3 border-b border-[var(--border)] pb-2 text-lg font-semibold leading-tight text-[var(--color-text-primary)]">
        Block-space utilization &amp; gas efficiency
      </h3>
      <p className="mb-4 text-xs leading-[1.4] text-[var(--muted)]">
        Block-space utilization % = gas_used / consensus block gas limit per bucket (true demand for
        block space). Gas efficiency % = gas_used / gas_wanted (how much reserved gas was consumed).
        Buckets without a recorded limit / requested gas leave a gap. Dashed line is the OLS trend of
        utilization.
      </p>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
            <XAxis {...timeAxis} />
            <YAxis
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
                    {filtered.map((e, i) => (
                      <p key={i} style={{ color: chartTheme.tooltipText }}>
                        {String(e.name ?? "")}:{" "}
                        {typeof e.value === "number" ? `${e.value.toFixed(2)}%` : String(e.value ?? "")}
                      </p>
                    ))}
                  </div>
                );
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="blockGasUtilizationPct"
              name="Block-space utilization %"
              stroke={chartTheme.lineA}
              dot={false}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="gasEfficiencyPct"
              name="Gas efficiency %"
              stroke={chartTheme.lineB}
              dot={false}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="blockGasUtilizationPctTrend"
              name="Block-space utilization % (trend)"
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
