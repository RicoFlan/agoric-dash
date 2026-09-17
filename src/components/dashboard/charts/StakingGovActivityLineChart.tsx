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
import type { StakingGovActivityRow } from "@/lib/stakingGovActivitySeries";
import { filterNonZeroTooltipPayload, formatTooltipNumber } from "@/lib/rechartsTooltip";

type XAxisSpread = ComponentProps<typeof XAxis>;

const LINES: { key: keyof StakingGovActivityRow; name: string; stroke: string }[] = [
  { key: "delegations", name: "Delegations", stroke: chartTheme.lineA },
  { key: "undelegations", name: "Undelegations", stroke: chartTheme.lineD },
  { key: "redelegations", name: "Redelegations", stroke: chartTheme.lineE },
  { key: "govVotes", name: "Governance votes", stroke: chartTheme.lineB },
  { key: "govProposals", name: "Proposals submitted", stroke: chartTheme.lineC },
];

export default function StakingGovActivityLineChart({
  data,
  timeAxis,
}: {
  data: StakingGovActivityRow[];
  timeAxis: XAxisSpread;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h3 className="mb-3 border-b border-[var(--border)] pb-2 text-lg font-semibold leading-tight text-[var(--color-text-primary)]">
        Staking &amp; governance activity
      </h3>
      <p className="mb-4 text-xs leading-[1.4] text-[var(--muted)]">
        Message counts per bucket in successful txs (one message = one action), not token amounts or
        unique accounts. Top-level messages only — authz <code>MsgExec</code>-wrapped actions are not
        counted.
      </p>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
            <XAxis {...timeAxis} />
            <YAxis tick={{ fill: chartTheme.axisTick, fontSize: 11 }} />
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
              <Line
                key={l.key}
                type="monotone"
                dataKey={l.key}
                name={l.name}
                stroke={l.stroke}
                dot={false}
               connectNulls={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
