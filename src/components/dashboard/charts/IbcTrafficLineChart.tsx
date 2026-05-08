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

type XAxisSpread = ComponentProps<typeof XAxis>;

export default function IbcTrafficLineChart({
  data,
  timeAxis,
}: {
  data: { bucket: string; out: number; recv: number }[];
  timeAxis: XAxisSpread;
}) {
  const rows = useMemo(() => {
    const outT = linearTrendLine(data.map((d) => d.out));
    const recvT = linearTrendLine(data.map((d) => d.recv));
    return data.map((row, i) => ({
      ...row,
      outTrend: outT[i]!,
      recvTrend: recvT[i]!,
    }));
  }, [data]);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h3 className="mb-3 border-b border-[var(--border)] pb-2 text-lg font-semibold leading-tight text-[var(--color-text-primary)]">
        IBC traffic: out vs received
      </h3>
      <p className="mb-4 text-xs leading-[1.4] text-[var(--muted)]">
        Agoric-3 only. Out = outbound ICS-20 MsgTransfer messages per bucket. Received = distinct
        recv_packet identities when indexed; legacy buckets may fall back to MsgRecvPacket counts.
        Ack/timeouts/handshakes are not these lines. Out plus recv is not net throughput — same
        transfer can be counted on another chain too.
      </p>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
            <XAxis {...timeAxis} />
            <YAxis yAxisId={0} tick={{ fill: chartTheme.axisTick, fontSize: 11 }} />
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
            <Legend />
            <Line
              yAxisId={0}
              type="monotone"
              dataKey="out"
              name="Out (MsgTransfer msgs)"
              stroke={chartTheme.lineB}
              dot={false}
            />
            <Line
              yAxisId={0}
              type="monotone"
              dataKey="recv"
              name="Received (flow / msg count)"
              stroke={chartTheme.lineD}
              dot={false}
            />
            <Line
              yAxisId={0}
              type="monotone"
              dataKey="outTrend"
              name="Out (trend)"
              stroke={chartTheme.lineB}
              dot={false}
              strokeOpacity={0.85}
              {...chartTheme.trendLineProps}
            />
            <Line
              yAxisId={0}
              type="monotone"
              dataKey="recvTrend"
              name="Received (trend)"
              stroke={chartTheme.lineD}
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
