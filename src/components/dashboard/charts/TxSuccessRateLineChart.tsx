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
import type { SuccessRateRow } from "@/lib/successRateSeries";
import { filterNonZeroTooltipPayload, formatTooltipNumber } from "@/lib/rechartsTooltip";

type XAxisSpread = ComponentProps<typeof XAxis>;

export default function TxSuccessRateLineChart({
  data,
  timeAxis,
}: {
  data: SuccessRateRow[];
  timeAxis: XAxisSpread;
}) {
  const rows = useMemo(() => {
    const rateTrend = linearTrendLine(data.map((d) => d.successRatePct));
    return data.map((row, i) => ({ ...row, successRatePctTrend: rateTrend[i]! }));
  }, [data]);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h3 className="mb-3 border-b border-[var(--border)] pb-2 text-lg font-semibold leading-tight text-[var(--color-text-primary)]">
        Transaction success rate vs failed txs
      </h3>
      <p className="mb-4 text-xs leading-[1.4] text-[var(--muted)]">
        Left axis: success rate % = tx_success / (tx_success + tx_failed) per bucket (ABCI code 0 vs
        ≠0). Right axis: failed inclusions (count). Buckets with no aligned txs leave a gap in the rate
        line. Dashed line is the OLS trend of the success rate.
      </p>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
            <XAxis {...timeAxis} />
            <YAxis
              yAxisId="rate"
              domain={[0, 100]}
              tick={{ fill: chartTheme.axisTick, fontSize: 11 }}
              tickFormatter={(v) => `${v}%`}
            />
            <YAxis
              yAxisId="count"
              orientation="right"
              tick={{ fill: chartTheme.axisTick, fontSize: 11 }}
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
                      const isRate = String(e.dataKey ?? "").startsWith("successRatePct");
                      const val =
                        isRate && typeof e.value === "number"
                          ? `${e.value.toFixed(2)}%`
                          : formatTooltipNumber(e.value);
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
              yAxisId="rate"
              type="monotone"
              dataKey="successRatePct"
              name="Success rate %"
              stroke={chartTheme.lineA}
              dot={false}
              connectNulls={false}
            />
            <Line
              yAxisId="count"
              type="monotone"
              dataKey="failed"
              name="Failed txs"
              stroke={chartTheme.lineD}
              dot={false}
             connectNulls={false} />
            <Line
              yAxisId="rate"
              type="monotone"
              dataKey="successRatePctTrend"
              name="Success rate % (trend)"
              stroke={chartTheme.lineA}
              dot={false}
              strokeOpacity={0.85}
              {...chartTheme.trendLineProps}
             connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
