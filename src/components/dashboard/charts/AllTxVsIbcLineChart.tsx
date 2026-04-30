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

export default function AllTxVsIbcLineChart({
  data,
  timeAxis,
}: {
  data: { bucket: string; totalTx: number; ibcMsgs: number }[];
  timeAxis: XAxisSpread;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="mb-1 text-lg font-semibold leading-tight text-[var(--color-text-primary)]">
        All transactions and IBC message volume
      </h2>
      <p className="mb-4 text-xs text-[var(--muted)]">
        All txs = success + failed (inclusions). IBC = outbound MsgTransfer + recv (ICS-20
        handling), per bucket. One vertical scale for both (counts per bucket).
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
              dataKey="totalTx"
              name="All transactions"
              stroke={chartTheme.lineA}
              dot={false}
            />
            <Line
              yAxisId={0}
              type="monotone"
              dataKey="ibcMsgs"
              name="IBC (out + recv)"
              stroke={chartTheme.lineC}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
