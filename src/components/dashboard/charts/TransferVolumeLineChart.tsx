"use client";

import type { ComponentProps } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
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

  /** Denoms whose lines are hidden (empty = all visible). Reset when the loaded series set changes. */
  const [hiddenDenoms, setHiddenDenoms] = useState<Set<string>>(() => new Set());
  const seriesSignature = useMemo(() => series.map((s) => s.denom).join("\0"), [series]);

  useEffect(() => {
    setHiddenDenoms(new Set());
  }, [seriesSignature]);

  const toggleDenom = useCallback((denom: string) => {
    setHiddenDenoms((prev) => {
      const next = new Set(prev);
      if (next.has(denom)) next.delete(denom);
      else next.add(denom);
      return next;
    });
  }, []);

  const visibleSeries = useMemo(
    () => series.filter((s) => !hiddenDenoms.has(s.denom)),
    [series, hiddenDenoms]
  );

  const chartHeightClass =
    visibleSeries.length > 10 ? "min-h-[28rem] h-[28rem]" : visibleSeries.length > 0 ? "h-72" : "h-48";

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h3 className="mb-3 border-b border-[var(--border)] pb-2 text-lg font-semibold leading-tight text-[var(--color-text-primary)]">
        Gross in-tx movement (per asset)
      </h3>
      <p className="mb-4 text-xs leading-[1.4] text-[var(--muted)]">
        Per-bucket total = transfer <strong className="font-medium text-[var(--color-text-secondary)]">message</strong> amounts (send / multi / out) + IBC{" "}
        <strong className="font-medium text-[var(--color-text-secondary)]">recv</strong> for that denom — same as the table above; a single tx with several msgs adds several legs. Human-scaled when mapped in{" "}
        <code className="text-[var(--accent)]">src/config/denoms.json</code>. Y-axis mixes assets. IBC flow chart below keeps recv/out split.
      </p>
      {hasData ? (
        <>
          <fieldset className="mb-4 rounded-md border border-[var(--border)]/80 bg-[var(--bg)]/40 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-accent)]">
              Show assets
            </legend>
            <p className="mb-2 text-xs text-[var(--muted)]">
              Uncheck to hide a line from the chart. Your choices reset when you change the date range or refresh data.
            </p>
            <div className="max-h-40 overflow-y-auto pr-1">
              <ul className="flex flex-wrap gap-x-4 gap-y-2">
                {series.map((s) => {
                  const label = s.displaySymbol || s.denom;
                  const checked = !hiddenDenoms.has(s.denom);
                  return (
                    <li key={s.denom}>
                      <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--text)]">
                        <input
                          type="checkbox"
                          className="size-3.5 shrink-0 rounded border-[var(--border)] accent-[var(--accent)]"
                          checked={checked}
                          onChange={() => toggleDenom(s.denom)}
                        />
                        <span className="max-w-[14rem] truncate" title={s.denom}>
                          {label}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          </fieldset>

          {visibleSeries.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No assets selected — check at least one asset above to see the chart.
            </p>
          ) : (
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
                            const meta = visibleSeries.find((s) => s.chartKey === e.dataKey);
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
                        className="inline-block max-w-[160px] truncate align-bottom"
                        style={{ color: chartTheme.tooltipText }}
                        title={typeof v === "string" ? v : String(v)}
                      >
                        {v}
                      </span>
                    )}
                  />
                  {visibleSeries.map((s, i) => (
                    <Line
                      key={s.denom}
                      yAxisId={0}
                      type="monotone"
                      dataKey={s.chartKey}
                      name={s.displaySymbol || s.denom}
                      stroke={LINE_STROKES[i % LINE_STROKES.length]}
                      dot={false}
                      strokeWidth={visibleSeries.length > 12 ? 1.25 : 1.5}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-[var(--muted)]">No bank / outbound IBC transfer amounts in the selected range.</p>
      )}
    </div>
  );
}
