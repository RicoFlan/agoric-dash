"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import { useEffect, useMemo, useState } from "react";
import type { XAxis } from "recharts";
import { ChartChunkFallback } from "@/components/dashboard/ChartChunkFallback";
import {
  CARD_CLASS,
  EmptyNote,
  fmtUsd,
  Headline,
  IN_CARD_TITLE_CLASS,
  QuestionBlock,
  SupportFigure,
  TABLE_CLASS,
  TABLE_HEAD_ROW_CLASS,
  TABLE_ROW_CLASS,
} from "@/components/dashboard/primitives";
import type { MetricsPayload } from "@/components/dashboard/types";
import { UsdBasisNote } from "@/components/dashboard/UsdBasisNote";
import { atomicToFloat } from "@/lib/amountFormat";
import { dashboardSectionIds } from "@/lib/dashboardNav";
import type { QuestionsPayload } from "@/lib/questionsPayload";
import { INDEXER_SCOPE_CAVEAT_SUBTITLE } from "@/lib/semantics";

type XAxisSpread = ComponentProps<typeof XAxis>;

const NetIbcFlowChart = dynamic(() => import("@/components/dashboard/charts/NetIbcFlowChart"), {
  loading: () => <ChartChunkFallback title="Net IBC flow" />,
  ssr: false,
});

/** Signed native amount (atomic string) → human number, or null when decimals are unknown. */
function humanSigned(atomic: string, decimals: number | undefined): number | null {
  if (typeof decimals !== "number" || !Number.isFinite(decimals)) return null;
  const neg = atomic.startsWith("-");
  const n = atomicToFloat(neg ? atomic.slice(1) : atomic, decimals);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

function fmtNative(n: number | null): string {
  if (n === null) return "—";
  const s = Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  return n < 0 ? `−${s}` : s;
}

/** Parse a formatted "$1,234.56" cell back to a number for sorting; null for "—"/null. */
function usdCellToNumber(s: string | null | undefined): number | null {
  if (!s) return null;
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Q3 — Is value flowing in or out? Headline: net IBC flow in USD (in − out), day-priced. */
export function Q3ValueFlow({
  data,
  q,
  timeAxis,
}: {
  data: MetricsPayload;
  q: QuestionsPayload["q3"] | undefined;
  timeAxis: XAxisSpread;
}) {
  const disp = data.display;
  const sym = (denom: string) => disp?.metas[denom]?.displaySymbol || denom;
  const byAsset = useMemo(() => q?.byAsset ?? [], [q?.byAsset]);
  const chartable = useMemo(() => (q?.perBucket ?? []).map((p) => p.denom), [q?.perBucket]);

  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (!selected || !chartable.includes(selected)) setSelected(chartable[0] ?? null);
  }, [chartable, selected]);

  const chartRows = useMemo(() => {
    if (!selected) return [];
    const series = q?.perBucket.find((p) => p.denom === selected);
    const dec = disp?.metas[selected]?.decimals;
    if (!series) return [];
    return series.data.map((r) => ({
      bucket: r.bucket,
      net: humanSigned(r.net, dec) ?? 0,
      in: humanSigned(r.in, dec) ?? 0,
      out: humanSigned(r.out, dec) ?? 0,
    }));
  }, [q?.perBucket, selected, disp]);

  const creditsRows = useMemo(() => {
    const bc = data.bankCreditsVolumeByDenom ?? {};
    return Object.keys(bc)
      .filter((d) => BigInt(bc[d]!) > BigInt(0))
      .map((denom) => {
        const dec = disp?.metas[denom]?.decimals;
        const usd = data.bankCreditsVolumeUsdByDenom?.[denom] ?? null;
        return { denom, symbol: sym(denom), native: fmtNative(humanSigned(bc[denom]!, dec)) === "—" ? bc[denom]! : fmtNative(humanSigned(bc[denom]!, dec)), usd, usdN: usdCellToNumber(usd) };
      })
      .sort((a, b) => {
        if (a.usdN !== null && b.usdN !== null) return b.usdN - a.usdN;
        if (a.usdN !== null) return -1;
        if (b.usdN !== null) return 1;
        return a.symbol < b.symbol ? -1 : 1;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.bankCreditsVolumeByDenom, data.bankCreditsVolumeUsdByDenom, disp]);

  const h = q?.headline;

  return (
    <QuestionBlock
      id={dashboardSectionIds.valueFlow}
      eyebrow="Q3"
      title="Is value flowing in or out?"
      intro={
        <>
          Net IBC flow is what arrived on agoric-3 over IBC minus what left, per asset, each day&apos;s amount priced at
          that day&apos;s CoinGecko price. Gross flow, not TVL and not supply. Native amounts are never summed across
          assets; only USD is. {INDEXER_SCOPE_CAVEAT_SUBTITLE}
        </>
      }
      headline={
        <Headline
          label="Net IBC flow (USD)"
          value={fmtUsd(h?.netUsd ?? null, true)}
          previous={fmtUsd(h?.previousNetUsd ?? null, true)}
          delta={h?.deltaUsd === null || h?.deltaUsd === undefined ? "n/a" : `${fmtUsd(h.deltaUsd, true)} vs prior`}
          deltaValue={h?.deltaUsd ?? null}
          definition="Σ over priced assets of (IBC amount in − IBC amount out), each (asset, day) leg × that day's price. Positive = net inflow to Agoric."
          aside={
            q ? (
              <>
                In {fmtUsd(h?.inUsd ?? null)} · Out {fmtUsd(h?.outUsd ?? null)}
                <UsdBasisNote meta={q.usdPricingMeta} />
              </>
            ) : undefined
          }
        />
      }
      detailLabel="Value handled detail — bank credits by asset (all denoms), pricing basis"
      detail={
        <div className={CARD_CLASS}>
          <h3 className={IN_CARD_TITLE_CLASS}>Value received by asset (bank credits, range total)</h3>
          <p className="mb-3 text-xs leading-snug text-[var(--muted)]">
            <code className="text-[var(--accent)]">coin_received</code> to non-module receivers in successful txs
            (<code className="text-[var(--accent)]">bank_credits_volume</code>) — captures bank sends, IBC receipts,
            and contract/vbank flows regardless of message type. USD is day-priced. The sender-side{" "}
            <code className="text-[var(--accent)]">transfer_volume</code> basis is no longer shown as a column; it remains
            the input for gross-movement concentration in Q4.
            {data.usdPricingMeta && <UsdBasisNote meta={data.usdPricingMeta} />}
          </p>
          {creditsRows.length === 0 ? (
            <EmptyNote>No bank credits in range.</EmptyNote>
          ) : (
            <div className="min-w-0 max-w-full overflow-x-auto">
              <table className={TABLE_CLASS}>
                <thead>
                  <tr className={TABLE_HEAD_ROW_CLASS}>
                    <th className="py-2 pr-4 font-semibold">Asset</th>
                    <th className="py-2 pr-4 text-right font-semibold">Bank credits</th>
                    <th className="py-2 pr-4 text-right font-semibold">USD (day-priced)</th>
                    <th className="py-2 font-semibold">Denom</th>
                  </tr>
                </thead>
                <tbody>
                  {creditsRows.map((r) => (
                    <tr key={r.denom} className={TABLE_ROW_CLASS}>
                      <td className="py-1.5 pr-4 font-mono text-[var(--text)]">{r.symbol}</td>
                      <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-[var(--text)]">{r.native}</td>
                      <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-[var(--text)]">{r.usd ?? "—"}</td>
                      <td className="max-w-[16rem] truncate py-1.5 font-mono text-xs text-[var(--muted)]" title={r.denom}>
                        {r.denom}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-[var(--border)] font-semibold">
                    <td className="py-2 pr-4 text-[var(--color-text-secondary)]">TOTAL (priced rows)</td>
                    <td className="py-2 pr-4 text-center text-[var(--muted)]" title="Not summed across assets">—</td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums">{data.bankCreditsVolumeUsdTotal ?? "—"}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">Asset</span>
          <select
            value={selected ?? ""}
            onChange={(e) => setSelected(e.target.value)}
            disabled={chartable.length === 0}
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--text)] transition-colors hover:bg-[var(--color-bg-secondary)]"
          >
            {chartable.map((d) => (
              <option key={d} value={d}>
                {sym(d)}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-[var(--muted)]">Top assets by absolute net USD in range.</span>
      </div>
      {selected && chartRows.length > 0 ? (
        <NetIbcFlowChart data={chartRows} symbol={sym(selected)} timeAxis={timeAxis} />
      ) : (
        <div className={CARD_CLASS}>
          <EmptyNote>No IBC transfers in range.</EmptyNote>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <SupportFigure label="IBC in (USD)" value={fmtUsd(h?.inUsd ?? null)} definition="IBC amounts received on agoric-3 (deduped recv_packet basis), day-priced and summed across assets." />
        <SupportFigure label="Value received on-chain (USD)" value={data.bankCreditsVolumeUsdTotal ?? "—"} definition="Bank credits to non-module receivers in successful txs, day-priced; broader than IBC (includes bank sends and contract flows). See Detail." />
      </div>
      <div className={CARD_CLASS}>
        <h3 className={IN_CARD_TITLE_CLASS}>Net flow by asset</h3>
        <p className="mb-3 text-xs leading-snug text-[var(--muted)]">
          Range totals per asset. Priced assets first by absolute net USD; unpriced assets last (no CoinGecko mapping).
        </p>
        {byAsset.length === 0 ? (
          <EmptyNote>No IBC transfers in range.</EmptyNote>
        ) : (
          <div className="min-w-0 max-w-full overflow-x-auto">
            <table className={TABLE_CLASS}>
              <thead>
                <tr className={TABLE_HEAD_ROW_CLASS}>
                  <th className="py-2 pr-4 font-semibold">Asset</th>
                  <th className="py-2 pr-4 text-right font-semibold">Net</th>
                  <th className="py-2 pr-4 text-right font-semibold">Net USD</th>
                  <th className="py-2 pr-4 text-right font-semibold">In</th>
                  <th className="py-2 pr-4 text-right font-semibold">Out</th>
                  <th className="py-2 text-right font-semibold">In / Out USD</th>
                </tr>
              </thead>
              <tbody>
                {byAsset.slice(0, 10).map((a) => {
                  const dec = disp?.metas[a.denom]?.decimals;
                  return (
                    <tr key={a.denom} className={TABLE_ROW_CLASS}>
                      <td className="py-1.5 pr-4 font-mono text-[var(--text)]" title={a.denom}>{sym(a.denom)}</td>
                      <td className={`py-1.5 pr-4 text-right font-mono tabular-nums ${a.net.startsWith("-") ? "text-[var(--color-warning)]" : "text-[var(--text)]"}`}>{fmtNative(humanSigned(a.net, dec))}</td>
                      <td className={`py-1.5 pr-4 text-right font-mono tabular-nums ${a.netUsd !== null && a.netUsd < 0 ? "text-[var(--color-warning)]" : "text-[var(--text)]"}`}>{fmtUsd(a.netUsd, true)}</td>
                      <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-[var(--muted)]">{fmtNative(humanSigned(a.in, dec))}</td>
                      <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-[var(--muted)]">{fmtNative(humanSigned(a.out, dec))}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-[var(--muted)]">{fmtUsd(a.inUsd)} / {fmtUsd(a.outUsd)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </QuestionBlock>
  );
}
