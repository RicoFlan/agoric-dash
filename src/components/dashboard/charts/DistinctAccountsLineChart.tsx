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

export default function DistinctAccountsLineChart({
  data,
  timeAxis,
}: {
  data: { bucket: string; distinctAccounts: number }[];
  timeAxis: XAxisSpread;
}) {
  const showDots = data.length > 0 && data.length <= 45;

  const rows = useMemo(() => {
    const trend = linearTrendLine(data.map((d) => d.distinctAccounts));
    return data.map((row, i) => ({
      ...row,
      distinctAccountsTrend: trend[i]!,
    }));
  }, [data]);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h3 className="mb-3 border-b border-[var(--border)] pb-2 text-lg font-semibold leading-tight text-[var(--color-text-primary)]">
        Distinct account addresses over time
      </h3>
      <p className="mb-4 text-xs leading-[1.4] text-[var(--muted)]">
        One point per UTC calendar day: unique addresses that appeared as a signer or fee payer on
        at least one successful tx that day (each address counted once per day). Independent of
        Granularity above — source is indexed daily rolls. Days with no matching activity show 0.
        Not comparable to daily successful-tx totals on other charts — many txs can share one address.
      </p>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 4, right: 8, left: 4, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
            <XAxis {...timeAxis} />
            <YAxis
              yAxisId={0}
              tick={{ fill: chartTheme.axisTick, fontSize: 11 }}
              allowDecimals={false}
            />
            <Tooltip
              content={({ active, label, payload }) => {
                const filtered = filterNonZeroTooltipPayload(payload);
                if (!active || !filtered.length) return null;
                const header =
                  typeof label === "string" || typeof label === "number"
                    ? `UTC ${String(label).slice(0, 10)}`
                    : String(label);
                return (
                  <div
                    className="rounded-md border p-2 text-xs"
                    style={{
                      borderColor: chartTheme.tooltipBorder,
                      background: chartTheme.tooltipBg,
                    }}
                  >
                    <p style={{ color: chartTheme.tooltipMuted }}>{header}</p>
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
              dataKey="distinctAccounts"
              name="Distinct account addresses"
              stroke={chartTheme.lineA}
              dot={showDots}
              strokeWidth={1.75}
            />
            <Line
              yAxisId={0}
              type="monotone"
              dataKey="distinctAccountsTrend"
              name="Distinct account addresses (trend)"
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
