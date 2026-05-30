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
import type { OffersActivityRow } from "@/lib/offersActivitySeries";
import { filterNonZeroTooltipPayload, formatTooltipNumber } from "@/lib/rechartsTooltip";

type XAxisSpread = ComponentProps<typeof XAxis>;

const LINES: { key: keyof Omit<OffersActivityRow, "bucket">; name: string; stroke: string }[] = [
  { key: "interactive", name: "Interactive (vaults/PSM/auction/gov)", stroke: chartTheme.lineA },
  { key: "automated", name: "Automated (orchestration/oracle/fast-USDC)", stroke: chartTheme.lineD },
  { key: "unknown", name: "Uncategorized", stroke: chartTheme.axisLabelMuted },
];

export default function OffersActivityLineChart({
  data,
  timeAxis,
}: {
  data: OffersActivityRow[];
  timeAxis: XAxisSpread;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h3 className="mb-3 border-b border-[var(--border)] pb-2 text-lg font-semibold leading-tight text-[var(--color-text-primary)]">
        Smart-wallet offer activity (by automation class)
      </h3>
      <p className="mb-4 text-xs leading-[1.4] text-[var(--muted)]">
        Wallet actions per bucket, grouped by the functional category&apos;s automation class. Automated flows
        (orchestration, oracle pushes, fast-USDC settlement) dominate raw counts; the interactive line
        (vaults, PSM, auction, governance offers) is the closer proxy for deliberate user activity. This is a
        read-time grouping of <code>offer_category</code> — counts are wallet actions, not distinct wallets.
      </p>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
            <XAxis {...timeAxis} />
            <YAxis tick={{ fill: chartTheme.axisTick, fontSize: 11 }} allowDecimals={false} />
            <Tooltip
              content={({ active, label, payload }) => {
                const filtered = filterNonZeroTooltipPayload(payload);
                if (!active || !filtered.length) return null;
                return (
                  <div
                    className="rounded-md border p-2 text-xs"
                    style={{ borderColor: chartTheme.tooltipBorder, background: chartTheme.tooltipBg }}
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
            {LINES.map((l) => (
              <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.stroke} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
