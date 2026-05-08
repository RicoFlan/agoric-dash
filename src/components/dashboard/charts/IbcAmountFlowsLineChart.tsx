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
import { filterNonZeroTooltipPayload, formatTooltipNumber } from "@/lib/rechartsTooltip";

const LINE_STROKES = [
  chartTheme.lineA,
  chartTheme.lineB,
  chartTheme.lineC,
  chartTheme.lineD,
  chartTheme.lineE,
] as const;

export type IbcFlowSeriesMeta = {
  chartKey: string;
  denom: string;
  displaySymbol: string | null;
  direction: "in" | "out";
};

export type IbcAmountFlowsModel = {
  rows: Array<{ bucket: string } & Record<string, number>>;
  series: IbcFlowSeriesMeta[];
};

type XAxisSpread = ComponentProps<typeof XAxis>;

export default function IbcAmountFlowsLineChart({
  model,
  timeAxis,
}: {
  model: IbcAmountFlowsModel;
  timeAxis: XAxisSpread;
}) {
  const { rows, series } = model;
  const hasData = series.length > 0;
  const chartHeightClass = series.length > 10 ? "min-h-[28rem] h-[28rem]" : "h-72";

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h3 className="mb-3 border-b border-[var(--border)] pb-2 text-lg font-semibold leading-tight text-[var(--color-text-primary)]">
        IBC amount flows (separate from bank sends above)
      </h3>
      <p className="mb-4 text-xs leading-[1.4] text-[var(--muted)]">
        Native minimal units: <span className="text-[var(--text)]">in</span> ={" "}
        <code className="text-[var(--accent)]">ibc_transfer_amount_in</code> (recv events);{" "}
        <span className="text-[var(--text)]">out</span> ={" "}
        <code className="text-[var(--accent)]">ibc_transfer_amount_out</code> (MsgTransfer token).
        These are <strong className="font-medium text-[var(--color-text-secondary)]">amounts</strong>, not the message/flow count KPIs in Transaction activity. One line per denom (human-scaled when mapped in{" "}
        <code className="text-[var(--accent)]">src/config/denoms.json</code>). Not comparable across assets or to fee KPIs.
      </p>
      {hasData ? (
        <div className={`w-full ${chartHeightClass}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 4, right: 8, left: 4, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
              <XAxis {...timeAxis} />
              <YAxis yAxisId={0} tick={{ fill: chartTheme.axisTick, fontSize: 10 }} />
              <Tooltip
                content={({ label: lb, active, payload: pl }) => {
                  const filtered = filterNonZeroTooltipPayload(pl);
                  return active && filtered.length ? (
                    <div
                      className="max-h-64 overflow-y-auto rounded-md border p-2 text-xs"
                      style={{
                        borderColor: chartTheme.tooltipBorder,
                        background: chartTheme.tooltipBg,
                      }}
                    >
                      <p style={{ color: chartTheme.tooltipMuted }}>{String(lb)}</p>
                      {filtered.map((e, i) => {
                        const y = e.value;
                        const meta = series.find((s) => s.chartKey === e.dataKey);
                        const title = meta?.denom ?? String(e.dataKey);
                        return (
                          <p key={i} style={{ color: chartTheme.tooltipText }} title={title}>
                            {String(e.name ?? "")}: {formatTooltipNumber(y)}
                          </p>
                        );
                      })}
                    </div>
                  ) : null;
                }}
              />
              <Legend
                verticalAlign="bottom"
                wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
                formatter={(v) => (
                  <span
                    className="max-w-[160px] truncate inline-block align-bottom"
                    style={{ color: chartTheme.tooltipText }}
                    title={typeof v === "string" ? v : String(v)}
                  >
                    {v}
                  </span>
                )}
              />
              {series.map((s, i) => {
                const label = s.displaySymbol || s.denom;
                const name = s.direction === "in" ? `${label} in` : `${label} out`;
                return (
                  <Line
                    key={`${s.direction}-${s.denom}-${s.chartKey}`}
                    yAxisId={0}
                    type="monotone"
                    dataKey={s.chartKey}
                    name={name}
                    stroke={LINE_STROKES[i % LINE_STROKES.length]}
                    dot={false}
                    strokeWidth={series.length > 12 ? 1.25 : 1.5}
                    strokeDasharray={s.direction === "out" ? "6 4" : undefined}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-sm text-[var(--muted)]">No IBC in/out amount data in this range.</p>
      )}
    </div>
  );
}
