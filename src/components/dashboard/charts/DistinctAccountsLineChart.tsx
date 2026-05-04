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

export default function DistinctAccountsLineChart({
  data,
  timeAxis,
}: {
  data: { bucket: string; distinctAccounts: number }[];
  timeAxis: XAxisSpread;
}) {
  const showDots = data.length > 0 && data.length <= 45;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h3 className="mb-3 border-b border-[var(--border)] pb-2 text-lg font-semibold leading-tight text-[var(--color-text-primary)]">
        Distinct account addresses over time
      </h3>
      <p className="mb-4 text-xs leading-[1.4] text-[var(--muted)]">
        One point per UTC calendar day: unique addresses that appeared as a signer or fee payer on
        at least one successful tx that day (each address counted once per day). Independent of
        Granularity above — source is indexed daily rolls. Days with no matching activity show 0.
      </p>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, left: 4, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
            <XAxis {...timeAxis} />
            <YAxis
              yAxisId={0}
              tick={{ fill: chartTheme.axisTick, fontSize: 11 }}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                background: chartTheme.tooltipBg,
                border: `1px solid ${chartTheme.tooltipBorder}`,
              }}
              labelFormatter={(label) =>
                typeof label === "string" || typeof label === "number"
                  ? `UTC ${String(label).slice(0, 10)}`
                  : ""
              }
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
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
