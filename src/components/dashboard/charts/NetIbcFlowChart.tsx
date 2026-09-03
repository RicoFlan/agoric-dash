"use client";

import type { ComponentProps } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "@/lib/chartTheme";

type XAxisSpread = ComponentProps<typeof XAxis>;

/**
 * Q3 chart: net IBC flow per bucket for ONE asset (in − out, human units), bars above the zero line
 * for net inflow and below for net outflow; the zero line is emphasised because sign is the message.
 */
export default function NetIbcFlowChart({
  data,
  symbol,
  timeAxis,
}: {
  data: { bucket: string; net: number; in: number; out: number }[];
  symbol: string;
  timeAxis: XAxisSpread;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h3 className="mb-3 border-b border-[var(--border)] pb-2 text-lg font-semibold leading-tight text-[var(--color-text-primary)]">
        Net IBC flow — {symbol}
      </h3>
      <p className="mb-4 text-xs leading-[1.4] text-[var(--muted)]">
        Per bucket: IBC amount received on agoric-3 minus IBC amount sent out, in {symbol}. Above the line = net
        inflow. Native units for this asset only; use the table below to compare assets in USD.
      </p>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
            <XAxis {...timeAxis} />
            <YAxis tick={{ fill: chartTheme.axisTick, fontSize: 11 }} tickFormatter={(v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 })} />
            <ReferenceLine y={0} stroke={chartTheme.axisTick} strokeWidth={1.5} />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
              content={({ active, label, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0]?.payload as { net: number; in: number; out: number } | undefined;
                if (!p) return null;
                const f = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
                return (
                  <div className="rounded-md border p-2 text-xs" style={{ borderColor: chartTheme.tooltipBorder, background: chartTheme.tooltipBg }}>
                    <p style={{ color: chartTheme.tooltipMuted }}>{String(label ?? "")}</p>
                    <p style={{ color: chartTheme.tooltipText }}>Net: {f(p.net)} {symbol}</p>
                    <p style={{ color: chartTheme.tooltipMuted }}>In: {f(p.in)} · Out: {f(p.out)}</p>
                  </div>
                );
              }}
            />
            <Legend />
            <Bar dataKey="net" name={`Net flow (${symbol})`} fill={chartTheme.lineA} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.bucket} fill={d.net >= 0 ? chartTheme.lineA : chartTheme.lineB} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
