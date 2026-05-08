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

export default function AllTxVsIbcLineChart({
  data,
  timeAxis,
}: {
  data: { bucket: string; successfulTx: number; ibcFlows: number }[];
  timeAxis: XAxisSpread;
}) {
  const rows = useMemo(() => {
    const txTrend = linearTrendLine(data.map((d) => d.successfulTx));
    const ibcTrend = linearTrendLine(data.map((d) => d.ibcFlows));
    return data.map((row, i) => ({
      ...row,
      successfulTxTrend: txTrend[i]!,
      ibcFlowsTrend: ibcTrend[i]!,
    }));
  }, [data]);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h3 className="mb-3 border-b border-[var(--border)] pb-2 text-lg font-semibold leading-tight text-[var(--color-text-primary)]">
        Successful txs vs IBC message / flow counts
      </h3>
      <p className="mb-4 text-xs leading-[1.4] text-[var(--muted)]">
        Left axis mixes units: successful txs are whole transactions (ABCI code 0). The IBC line sums
        message / inbound-flow counts (one per outbound MsgTransfer plus recv_packet / MsgRecvPacket
        semantics per methodology)—not txs. One vertical scale for both series (counts per bucket).
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
              dataKey="successfulTx"
              name="Successful transactions"
              stroke={chartTheme.lineA}
              dot={false}
            />
            <Line
              yAxisId={0}
              type="monotone"
              dataKey="ibcFlows"
              name="IBC msgs + recv flows (combined)"
              stroke={chartTheme.lineC}
              dot={false}
            />
            <Line
              yAxisId={0}
              type="monotone"
              dataKey="successfulTxTrend"
              name="Successful transactions (trend)"
              stroke={chartTheme.lineA}
              dot={false}
              strokeOpacity={0.85}
              {...chartTheme.trendLineProps}
            />
            <Line
              yAxisId={0}
              type="monotone"
              dataKey="ibcFlowsTrend"
              name="IBC msgs + recv flows (trend)"
              stroke={chartTheme.lineC}
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
