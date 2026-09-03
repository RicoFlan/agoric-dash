"use client";

import type { ComponentProps } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartTheme } from "@/lib/chartTheme";
import { filterNonZeroTooltipPayload, formatTooltipNumber } from "@/lib/rechartsTooltip";

type XAxisSpread = ComponentProps<typeof XAxis>;

/**
 * Q4 chart: effective number of addresses per UTC day on the fee basis (1 / HHI of day-priced fee
 * USD) and the gross-movement basis, plus the top-10 fee share on the right axis. Daily grain by
 * table design regardless of the selected granularity; days without priced activity are gaps.
 */
export default function EffectiveNLineChart({
  data,
  timeAxis,
}: {
  data: { day: string; effectiveNFee: number | null; effectiveNGross: number | null; top10FeeSharePct: number | null }[];
  timeAxis: XAxisSpread;
}) {
  const showDots = data.length > 0 && data.length <= 45;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h3 className="mb-3 border-b border-[var(--border)] pb-2 text-lg font-semibold leading-tight text-[var(--color-text-primary)]">
        Breadth of the economic base over time
      </h3>
      <p className="mb-4 text-xs leading-[1.4] text-[var(--muted)]">
        Effective number of addresses = 1 ÷ HHI: how many equally-active addresses would produce the same
        concentration. Fee basis (paid fees, hardest to fake) and gross-movement basis, per UTC day, left axis.
        Top-10 fee-payer share on the right axis. Higher effective-N = broader base.
      </p>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, left: 4, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
            <XAxis {...timeAxis} />
            <YAxis yAxisId="n" tick={{ fill: chartTheme.axisTick, fontSize: 11 }} allowDecimals={false} label={{ value: "effective N", angle: -90, position: "insideLeft", fill: chartTheme.axisTick, fontSize: 10 }} />
            <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tick={{ fill: chartTheme.axisTick, fontSize: 11 }} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip
              content={({ active, label, payload }) => {
                const filtered = filterNonZeroTooltipPayload(payload);
                if (!active || !filtered.length) return null;
                return (
                  <div className="rounded-md border p-2 text-xs" style={{ borderColor: chartTheme.tooltipBorder, background: chartTheme.tooltipBg }}>
                    <p style={{ color: chartTheme.tooltipMuted }}>UTC {String(label ?? "").slice(0, 10)}</p>
                    {filtered.map((e, i) => (
                      <p key={i} style={{ color: chartTheme.tooltipText }}>
                        {String(e.name ?? "")}: {formatTooltipNumber(e.value)}
                        {String(e.dataKey ?? "").includes("Pct") ? "%" : ""}
                      </p>
                    ))}
                  </div>
                );
              }}
            />
            <Legend />
            <Line yAxisId="n" type="monotone" dataKey="effectiveNFee" name="Effective N (fee basis)" stroke={chartTheme.lineA} dot={showDots} strokeWidth={1.75} connectNulls={false} />
            <Line yAxisId="n" type="monotone" dataKey="effectiveNGross" name="Effective N (gross basis)" stroke={chartTheme.lineB} dot={showDots} strokeWidth={1.25} connectNulls={false} />
            <Line yAxisId="pct" type="monotone" dataKey="top10FeeSharePct" name="Top-10 fee share" stroke={chartTheme.axisTick} dot={false} strokeWidth={1} strokeDasharray="4 3" connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
