"use client";

import type { ComponentProps } from "react";
import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnomalyPoint } from "@/lib/anomalies";
import { chartTheme } from "@/lib/chartTheme";
import { linearTrendLine } from "@/lib/linearTrend";
import { filterNonZeroTooltipPayload, formatTooltipNumber } from "@/lib/rechartsTooltip";

type XAxisSpread = ComponentProps<typeof XAxis>;

/**
 * Q1 chart: successful txs per bucket (chart grain) with a dashed OLS trend and, at day
 * granularity, a marker on each day the anomaly rule flagged (|z| ≥ threshold vs the trailing
 * 30 days). Markers are day-grain, so they are only drawn when buckets are days.
 */
export default function TxActivityLineChart({
  data,
  anomalies,
  bucketsAreDays,
  timeAxis,
}: {
  /** `successfulTx` is null before the series' coverage floor: draw a gap, never a zero. */
  data: { bucket: string; successfulTx: number | null }[];
  anomalies: AnomalyPoint[];
  bucketsAreDays: boolean;
  timeAxis: XAxisSpread;
}) {
  const showDots = data.length > 0 && data.length <= 45;
  const rows = useMemo(() => {
    const trend = linearTrendLine(data.map((d) => d.successfulTx));
    return data.map((row, i) => ({ ...row, successfulTxTrend: trend[i]! }));
  }, [data]);
  const markers = useMemo(() => {
    if (!bucketsAreDays) return [];
    const byBucket = new Map(data.map((d) => [d.bucket.slice(0, 10), d.successfulTx]));
    return anomalies.filter((a) => byBucket.has(a.day)).map((a) => ({ ...a, y: byBucket.get(a.day)! }));
  }, [anomalies, bucketsAreDays, data]);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h3 className="mb-3 border-b border-[var(--border)] pb-2 text-lg font-semibold leading-tight text-[var(--color-text-primary)]">
        Successful transactions over time
      </h3>
      <p className="mb-4 text-xs leading-[1.4] text-[var(--muted)]">
        Whole txs with ABCI code 0 per bucket. Dashed line is the OLS trend across the range.
        {bucketsAreDays
          ? " Ring markers are days the anomaly rule flagged as unusual vs the trailing 30 days."
          : " Anomaly markers appear at day granularity only."}
      </p>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 8, left: 4, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
            <XAxis {...timeAxis} />
            <YAxis yAxisId={0} tick={{ fill: chartTheme.axisTick, fontSize: 11 }} allowDecimals={false} />
            <Tooltip
              content={({ active, label, payload }) => {
                const filtered = filterNonZeroTooltipPayload(payload);
                if (!active || !filtered.length) return null;
                const key = String(label ?? "").slice(0, 10);
                const flagged = markers.find((m) => m.day === key);
                return (
                  <div className="rounded-md border p-2 text-xs" style={{ borderColor: chartTheme.tooltipBorder, background: chartTheme.tooltipBg }}>
                    <p style={{ color: chartTheme.tooltipMuted }}>{String(label ?? "")}</p>
                    {filtered.map((e, i) => (
                      <p key={i} style={{ color: chartTheme.tooltipText }}>
                        {String(e.name ?? "")}: {formatTooltipNumber(e.value)}
                      </p>
                    ))}
                    {flagged && (
                      <p style={{ color: chartTheme.tooltipText }}>
                        Unusual: z = {flagged.z.toFixed(1)} ({flagged.direction})
                      </p>
                    )}
                  </div>
                );
              }}
            />
            <Legend />
            <Line yAxisId={0} type="monotone" dataKey="successfulTx" name="Successful txs" stroke={chartTheme.lineA} dot={showDots} strokeWidth={1.75}  connectNulls={false} />
            <Line
              yAxisId={0}
              type="monotone"
              dataKey="successfulTxTrend"
              name="Successful txs (trend)"
              stroke={chartTheme.lineA}
              dot={false}
              strokeOpacity={0.85}
              {...chartTheme.trendLineProps}
             connectNulls={false} />
            {markers.map((m) => (
              <ReferenceDot
                key={m.day}
                yAxisId={0}
                x={data.find((d) => d.bucket.slice(0, 10) === m.day)?.bucket ?? m.day}
                y={m.y}
                r={7}
                fill="none"
                stroke={chartTheme.lineB}
                strokeWidth={2}
                ifOverflow="visible"
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
