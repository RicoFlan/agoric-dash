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
import { fmtCompactUsd } from "@/lib/compactNumber";
import { dashboardSectionIds } from "@/lib/dashboardNav";
import { buildVerdicts } from "@/lib/narrative";
import { DEFINITIONS } from "@/lib/definitions";
import { formatSharePct, ymaxContractSplit } from "@/lib/ymaxContractSplit";
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
      .filter((d) => /^\d+$/.test(bc[d]!) && BigInt(bc[d]!) > BigInt(0))
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
  const netUsd = fmtCompactUsd(h?.netUsd ?? null, true);
  const prevNetUsd = fmtCompactUsd(h?.previousNetUsd ?? null, true);
  const o = q?.orchestrated;
  /**
   * Per-contract composition of the headline. ymax0 and ymax1 are two concurrent deployments, so the
   * sum answers Q3's question correctly but hides that one of them holds essentially all of it.
   */
  const contractSplit = useMemo(() => ymaxContractSplit(o?.byVenue ?? []), [o?.byVenue]);
  const orchVenues = useMemo(() => (o?.byVenue ?? []).filter((v) => BigInt(v.principal.replace(/^-/, "")) > BigInt(0)), [o?.byVenue]);
  /**
   * Share of principal in the two largest venues. Suppressed unless EVERY venue holding principal is
   * priced: with an unpriced venue in the mix the ratio would describe only the priced subset while
   * reading as a statement about the whole.
   */
  const topTwoSharePct = useMemo(() => {
    const holding = (o?.byVenue ?? []).filter((v) => BigInt(v.principal.replace(/^-/, "")) > BigInt(0));
    if (holding.length < 3 || holding.some((v) => v.principalUsd === null)) return null;
    const priced = holding.map((v) => v.principalUsd as number);
    const total = priced.reduce((s, u) => s + u, 0);
    if (total <= 0) return null;
    const topTwo = [...priced].sort((a, b) => b - a).slice(0, 2).reduce((s, u) => s + u, 0);
    return (topTwo / total) * 100;
  }, [o?.byVenue]);
  const flowLine = useMemo(() => {
    if (!o) return null;
    const by = (t: string) => o.flowsInRange.filter((f) => f.flowType === t).reduce((s, f) => s + f.count, 0);
    return `${by("deposit")} deposits · ${by("withdraw")} withdrawals · ${by("rebalance")} rebalances in range`;
  }, [o]);

  const verdict = useMemo(
    () => (data.questions ? buildVerdicts(data.questions).find((v) => v.id === "value-flow") : undefined),
    [data.questions]
  );

  return (
    <QuestionBlock
      id={dashboardSectionIds.valueFlow}
      eyebrow="Q3"
      title="Is value flowing in or out?"
      verdict={verdict}
      intro={
        <>
          Net IBC flow is what arrived on agoric-3 over IBC minus what left, per asset, each day&apos;s amount priced at
          that day&apos;s CoinGecko price. Gross flow, not TVL and not supply. Native amounts are never summed across
          assets; only USD is. {INDEXER_SCOPE_CAVEAT_SUBTITLE}
        </>
      }
      headline={
        <Headline
          label="Net IBC flow, priced assets (USD)"
          value={netUsd.text}
          exact={netUsd.exact}
          previous={prevNetUsd.text}
          previousExact={prevNetUsd.exact}
          delta={h?.deltaUsd === null || h?.deltaUsd === undefined ? "n/a" : `${fmtUsd(h.deltaUsd, true)} vs prior`}
          deltaValue={h?.deltaUsd ?? null}
          definition={DEFINITIONS.q3_net_ibc_flow}
          aside={
            q ? (
              <>
                In {fmtUsd(h?.inUsd ?? null)} · Out {fmtUsd(h?.outUsd ?? null)}
                {h?.outOrchUsd !== null && h?.outOrchUsd !== undefined && h.outOrchUsd > 0 && (
                  <> (of which orchestrated {fmtUsd(h.outOrchUsd)})</>
                )}
                {h && (
                  <>
                    <br />
                    <span className={h.pricedAssets < h.activeAssets ? "font-semibold text-[var(--color-warning)]" : undefined}>
                      {h.pricedAssets} of {h.activeAssets} active assets priced.
                    </span>
                    {h.unpricedAssets.length > 0 && (
                      <>
                        {" "}
                        Excluded, no price available:{" "}
                        {h.unpricedAssets.slice(0, 3).map((a, i) => (
                          <span key={a.denom}>
                            {i > 0 ? ", " : ""}
                            {sym(a.denom)} {fmtNative(humanSigned(a.net, disp?.metas[a.denom]?.decimals))} net
                          </span>
                        ))}
                        {h.unpricedAssets.length > 3 ? `, and ${h.unpricedAssets.length - 3} more` : ""}.
                      </>
                    )}
                  </>
                )}
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
      <div className="grid gap-4 sm:grid-cols-3">
        <SupportFigure label="IBC in (USD)" value={fmtUsd(h?.inUsd ?? null)} definition={DEFINITIONS.q3_ibc_in_usd} />
        <SupportFigure label="Orchestrated IBC out (USD)" value={fmtUsd(h?.outOrchUsd ?? null)} definition={DEFINITIONS.q3_orch_outflow} note="EndBlock sends by contracts; not in tx-scoped counts." />
        <SupportFigure label="Value received on-chain (USD)" value={data.bankCreditsVolumeUsdTotal ?? "—"} definition={DEFINITIONS.q3_value_received_usd} />
      </div>
      <div className={CARD_CLASS}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
              Net capital deployed via orchestration, at cost (YMax)
              <span className="ml-1 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-[var(--border)] align-middle text-[10px] font-semibold normal-case tracking-normal" title={DEFINITIONS.q3_deployed_principal} aria-label={DEFINITIONS.q3_deployed_principal} tabIndex={0}>i</span>
            </h3>
            <p className="mt-2 font-mono text-4xl leading-none tracking-tight text-[var(--text)]">{o?.available ? fmtUsd(o.principalUsd) : "—"}</p>
            <p className="mt-2 text-xs text-[var(--muted)]">
              {o?.available
                ? `Capital sent to yield venues on other chains and not yet returned, at cost. It excludes yield or loss accrued at the venue, so it is not those positions' current value. Each position is at its latest published state, spanning heights ${o.oldestHeight ?? "—"} to ${o.latestHeight ?? "—"}.`
                : "Available after the YMax snapshot seed (npm run seed:ymax)."}
            </p>
          </div>
          {o?.available && (
            <div className="shrink-0 text-xs text-[var(--muted)] sm:max-w-xs sm:text-right">
              {o.portfoliosActive} active portfolios of {o.portfoliosTotal} created · net deposits in range {fmtUsd(o.netDepositsUsd, true)}
              <br />
              {flowLine}
              {contractSplit.length > 1 && (
                <>
                  <br />
                  <span className="text-[var(--color-text-secondary)]">Across {contractSplit.length} concurrent deployments:</span>{" "}
                  {contractSplit.map((c, i) => (
                    <span key={c.contract}>
                      {i > 0 ? " · " : ""}
                      <span className="font-mono">{c.contract}</span> {fmtUsd(c.principalUsd)}
                      {formatSharePct(c.sharePct) === null ? "" : ` (${formatSharePct(c.sharePct)})`}
                    </span>
                  ))}
                  . They are separate contracts, not one across a redeploy: portfolio numbering restarts in each.
                </>
              )}
              {o.quarantined.positions > 0 && (
                <>
                  <br />
                  <span className="font-semibold text-[var(--color-warning)]">
                    {o.quarantined.positions} positions excluded
                  </span>{" "}
                  because their outflow exceeds their inflow{o.quarantined.usd === null ? "" : ` (${fmtUsd(o.quarantined.usd)})`}, so the
                  figure is not behaving as a balance there.
                </>
              )}
              {o.freshness.stalePositions > 0 && (
                <>
                  <br />
                  {o.freshness.stalePositions} counted positions last published more than{" "}
                  {o.freshness.staleThresholdBlocks.toLocaleString("en-US")} blocks ago
                  {o.freshness.staleUsd === null ? "" : `, holding ${fmtUsd(o.freshness.staleUsd)}`}.
                </>
              )}
              <UsdBasisNote meta={o.usdPricingMeta} />
            </div>
          )}
        </div>
        {orchVenues.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs text-[var(--muted)]">
              By venue, largest first
              {orchVenues.length > 5 ? `, top 5 of ${orchVenues.length}` : ""}
              {topTwoSharePct !== null && (
                <>
                  . <span className="font-semibold text-[var(--color-text-secondary)]">{topTwoSharePct.toFixed(1)}% of priced principal sits in the two largest venues.</span>
                </>
              )}
            </p>
          <div className="min-w-0 max-w-full overflow-x-auto">
            <table className={TABLE_CLASS}>
              <thead>
                <tr className={TABLE_HEAD_ROW_CLASS}>
                  <th className="py-2 pr-4 font-semibold">Venue</th>
                  <th className="py-2 pr-4 font-semibold">Chain</th>
                  <th className="py-2 pr-4 font-semibold">Contract</th>
                  <th className="py-2 pr-4 text-right font-semibold">Portfolios</th>
                  <th className="py-2 pr-4 text-right font-semibold">Principal</th>
                  <th className="py-2 pr-4 text-right font-semibold">USD</th>
                  <th className="py-2 text-right font-semibold">Newest height</th>
                </tr>
              </thead>
              <tbody>
                {orchVenues.slice(0, 5).map((v) => (
                  <tr key={`${v.contract}|${v.protocol}|${v.chain}|${v.denom}`} className={TABLE_ROW_CLASS}>
                    <td className="py-1.5 pr-4 font-mono text-[var(--text)]">{v.protocol ?? "—"}</td>
                    <td className="py-1.5 pr-4 text-[var(--text)]">{v.chain ?? "—"}</td>
                    <td className="py-1.5 pr-4 font-mono text-[var(--muted)]">{v.contract}</td>
                    <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-[var(--muted)]">{v.portfolios}</td>
                    <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-[var(--text)]">{fmtNative(humanSigned(v.principal, v.denom ? disp?.metas[v.denom]?.decimals : undefined))} {v.denom ? sym(v.denom) : ""}</td>
                    <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-[var(--text)]">{fmtUsd(v.principalUsd)}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-[var(--muted)]">{v.latestHeight}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {orchVenues.length > 5 && (
            <details className="group mt-2">
              <summary className="cursor-pointer select-none text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--text)] [&::-webkit-details-marker]:hidden">
                <span className="mr-2 inline-block transition-transform group-open:rotate-90">▸</span>
                Remaining {orchVenues.length - 5} venues
              </summary>
              <div className="mt-2 min-w-0 max-w-full overflow-x-auto">
                <table className={TABLE_CLASS}>
                  <thead>
                    <tr className={TABLE_HEAD_ROW_CLASS}>
                      <th className="py-2 pr-4 font-semibold">Venue</th>
                      <th className="py-2 pr-4 font-semibold">Chain</th>
                      <th className="py-2 pr-4 font-semibold">Contract</th>
                      <th className="py-2 pr-4 text-right font-semibold">Portfolios</th>
                      <th className="py-2 pr-4 text-right font-semibold">Principal</th>
                      <th className="py-2 pr-4 text-right font-semibold">USD</th>
                      <th className="py-2 text-right font-semibold">Newest height</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orchVenues.slice(5).map((v) => (
                      <tr key={`${v.contract}|${v.protocol}|${v.chain}|${v.denom}`} className={TABLE_ROW_CLASS}>
                        <td className="py-1.5 pr-4 font-mono text-[var(--text)]">{v.protocol ?? "—"}</td>
                        <td className="py-1.5 pr-4 text-[var(--text)]">{v.chain ?? "—"}</td>
                        <td className="py-1.5 pr-4 font-mono text-[var(--muted)]">{v.contract}</td>
                        <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-[var(--muted)]">{v.portfolios}</td>
                        <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-[var(--text)]">
                          {fmtNative(humanSigned(v.principal, v.denom ? disp?.metas[v.denom]?.decimals : undefined))} {v.denom ? sym(v.denom) : ""}
                        </td>
                        <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-[var(--text)]">{fmtUsd(v.principalUsd)}</td>
                        <td className="py-1.5 text-right font-mono tabular-nums text-[var(--muted)]">{v.latestHeight}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          </div>
        )}
      </div>
      <div className={CARD_CLASS}>
        <h3 className={IN_CARD_TITLE_CLASS}>Net flow by asset</h3>
        <p className="mb-3 text-xs leading-snug text-[var(--muted)]">
          Range totals for the top 10 assets by absolute net USD (priced first; unpriced assets last, no CoinGecko mapping). Assets beyond the top 10 are omitted here, not zero.
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
