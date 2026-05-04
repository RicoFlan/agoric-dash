"use client";

import type { ComponentProps } from "react";
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

type XAxisSpread = ComponentProps<typeof XAxis>;

export default function IbcTrafficLineChart({
  data,
  timeAxis,
}: {
  data: { bucket: string; out: number; recv: number }[];
  timeAxis: XAxisSpread;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h3 className="mb-3 border-b border-[var(--border)] pb-2 text-lg font-semibold leading-tight text-[var(--color-text-primary)]">
        IBC traffic: out vs received
      </h3>
      <p className="mb-4 text-xs leading-[1.4] text-[var(--muted)]">
        Transfers out (MsgTransfer) and recv packet handling, per bucket.
      </p>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
            <XAxis {...timeAxis} />
            <YAxis yAxisId={0} tick={{ fill: chartTheme.axisTick, fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                background: chartTheme.tooltipBg,
                border: `1px solid ${chartTheme.tooltipBorder}`,
              }}
            />
            <Legend />
            <Line
              yAxisId={0}
              type="monotone"
              dataKey="out"
              name="IBC out"
              stroke={chartTheme.lineB}
              dot={false}
            />
            <Line
              yAxisId={0}
              type="monotone"
              dataKey="recv"
              name="IBC received"
              stroke={chartTheme.lineD}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
