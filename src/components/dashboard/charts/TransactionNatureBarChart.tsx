"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "@/lib/chartTheme";

export default function TransactionNatureBarChart({
  data,
  messageAttribution,
}: {
  data: { name: string; full: string; count: number }[];
  messageAttribution: string;
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="mb-2 text-lg font-semibold leading-tight text-[var(--color-text-primary)]">
        Transaction nature (first message only — {messageAttribution})
      </h2>
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 80 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
            <XAxis type="number" tick={{ fill: chartTheme.axisTick, fontSize: 11 }} />
            <YAxis
              type="category"
              dataKey="name"
              width={78}
              tick={{ fill: chartTheme.axisTick, fontSize: 10 }}
            />
            <Tooltip
              contentStyle={{
                background: chartTheme.tooltipBg,
                border: `1px solid ${chartTheme.tooltipBorder}`,
              }}
              formatter={(value: number) => [value, "count"]}
            />
            <Bar dataKey="count" fill={chartTheme.barPrimary} name="Txs" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
