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

const LINE_STROKES = [
  chartTheme.lineA,
  chartTheme.lineB,
  chartTheme.lineC,
  chartTheme.lineD,
  chartTheme.lineE,
] as const;

export type TransferVolumeSeriesMeta = {
  chartKey: string;
  denom: string;
  displaySymbol: string | null;
};

export type TransferVolumeModel = {
  rows: Array<{ bucket: string } & Record<string, number>>;
  series: TransferVolumeSeriesMeta[];
};

type XAxisSpread = ComponentProps<typeof XAxis>;

export default function TransferVolumeLineChart({
  model,
  timeAxis,
}: {
  model: TransferVolumeModel;
  timeAxis: XAxisSpread;
}) {
  const { rows, series } = model;
  const hasData = series.length > 0;
  const chartHeightClass = series.length > 10 ? "min-h-[28rem] h-[28rem]" : "h-72";

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="mb-1 text-lg font-semibold leading-tight text-[var(--color-text-primary)]">
        In-tx transfer volume (per asset)
      </h2>
      <p className="mb-4 text-xs text-[var(--muted)]">
        Value moved via MsgSend, MsgMultiSend, and outbound IBC amount fields — one line per denom
        with in-range volume (human-scaled when mapped in{" "}
        <code className="text-[var(--accent)]">src/config/denoms.json</code>). Y-axis mixes assets;
        amounts are not cross-asset comparable. IBC recv vs out amounts are in the chart below.
      </p>
      {hasData ? (
        <div className={`w-full ${chartHeightClass}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 4, right: 8, left: 4, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
              <XAxis {...timeAxis} />
              <YAxis
                yAxisId={0}
                tick={{ fill: chartTheme.axisTick, fontSize: 10 }}
                label={{
                  value: "Amount (human per asset; units differ)",
                  angle: -90,
                  position: "insideLeft",
                  style: { fill: chartTheme.axisLabelMuted, fontSize: 11 },
                }}
              />
              <Tooltip
                content={({ label: lb, active, payload: pl }) =>
                  active && pl && pl.length ? (
                    <div
                      className="max-h-64 overflow-y-auto rounded-md border p-2 text-xs"
                      style={{
                        borderColor: chartTheme.tooltipBorder,
                        background: chartTheme.tooltipBg,
                      }}
                    >
                      <p style={{ color: chartTheme.tooltipMuted }}>{String(lb)}</p>
                      {pl.map((e, i) => {
                        const y = e.value;
                        if (y == null || y === undefined) return null;
                        const meta = series.find((s) => s.chartKey === e.dataKey);
                        const title = meta?.denom ?? String(e.dataKey);
                        return (
                          <p key={i} style={{ color: chartTheme.tooltipText }} title={title}>
                            {e.name}: {typeof y === "number" ? y.toLocaleString() : y}
                          </p>
                        );
                      })}
                    </div>
                  ) : null
                }
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
              {series.map((s, i) => (
                <Line
                  key={s.denom}
                  yAxisId={0}
                  type="monotone"
                  dataKey={s.chartKey}
                  name={s.displaySymbol || s.denom}
                  stroke={LINE_STROKES[i % LINE_STROKES.length]}
                  dot={false}
                  strokeWidth={series.length > 12 ? 1.25 : 1.5}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-sm text-[var(--muted)]">No bank / outbound IBC transfer amounts in the selected range.</p>
      )}
    </div>
  );
}
