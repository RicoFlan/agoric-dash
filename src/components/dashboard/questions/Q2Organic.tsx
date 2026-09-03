"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import { useMemo } from "react";
import type { XAxis } from "recharts";
import { ChartChunkFallback } from "@/components/dashboard/ChartChunkFallback";
import { OfferCategoryTable, OfferEmpty, OfferLabeledTable } from "@/components/dashboard/OfferTables";
import {
  CARD_CLASS,
  EmptyNote,
  fmtInt,
  fmtPct,
  fmtPts,
  Headline,
  IN_CARD_TITLE_CLASS,
  KpiCard,
  QuestionBlock,
  SupportFigure,
  TABLE_CLASS,
  TABLE_HEAD_ROW_CLASS,
  TABLE_ROW_CLASS,
} from "@/components/dashboard/primitives";
import type { MetricsPayload } from "@/components/dashboard/types";
import { UsdBasisNote } from "@/components/dashboard/UsdBasisNote";
import { atomicToHumanString } from "@/lib/amountFormat";
import { dashboardSectionIds } from "@/lib/dashboardNav";
import { DEFINITIONS } from "@/lib/definitions";
import { buildOffersActivityRows } from "@/lib/offersActivitySeries";
import type { QuestionsPayload } from "@/lib/questionsPayload";

type XAxisSpread = ComponentProps<typeof XAxis>;

const OffersActivityLineChart = dynamic(() => import("@/components/dashboard/charts/OffersActivityLineChart"), {
  loading: () => <ChartChunkFallback title="Smart-wallet offer activity" />,
  ssr: false,
});

const pct1 = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n.toFixed(1)}%`);

/** Q2 — Is usage becoming more organic? Headline: interactive ÷ all wallet actions. */
export function Q2Organic({
  data,
  q,
  timeAxis,
}: {
  data: MetricsPayload;
  q: QuestionsPayload["q2"] | undefined;
  timeAxis: XAxisSpread;
}) {
  const offers = data.offers;
  const chartRows = useMemo(() => buildOffersActivityRows(offers?.categoriesOverTime ?? []), [offers?.categoriesOverTime]);
  const hasActivity = chartRows.some((r) => r.automated + r.interactive + r.unknown > 0);

  const valueRows = useMemo(() => {
    const v = offers?.value;
    if (!v) return [];
    const usd = data.offerValueUsd;
    const disp = data.display;
    const denoms = [...new Set([...Object.keys(v.giveByDenom), ...Object.keys(v.wantByDenom), ...Object.keys(v.payoutByDenom)])];
    return denoms
      .map((denom) => {
        const dec = disp?.metas[denom]?.decimals;
        const sym = disp?.metas[denom]?.displaySymbol || denom;
        const fmt = (atomic: string | undefined) => {
          if (!atomic || !/^\d+$/.test(atomic) || atomic === "0") return "—";
          return typeof dec === "number" ? atomicToHumanString(atomic, dec) : atomic;
        };
        return {
          denom,
          symbol: sym,
          payoutNative: fmt(v.payoutByDenom[denom]),
          payoutUsd: usd?.payouts.byDenom[denom] ?? null,
          giveNative: fmt(v.giveByDenom[denom]),
          giveUsd: usd?.give.byDenom[denom] ?? null,
          wantNative: fmt(v.wantByDenom[denom]),
          wantUsd: usd?.want.byDenom[denom] ?? null,
        };
      })
      .sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
  }, [offers?.value, data.offerValueUsd, data.display]);

  const ratio = q?.headline;
  const counts = q?.counts.current;
  const sat = q?.support.satisfactionByCategory ?? [];
  const walletsAvailable = q?.support.available ?? false;

  return (
    <QuestionBlock
      id={dashboardSectionIds.organic}
      eyebrow="Q2"
      title="Is usage becoming more organic?"
      intro={
        <>
          Most Agoric activity is smart-wallet intent (Zoe offers and invocations), and a few automation wallets submit most
          of it. The organic ratio is the share of wallet actions in interactive categories — vaults, PSM, auction,
          governance — versus automated ones (orchestration, oracle price feeds, fast-USDC). Distinct interactive wallets
          is the anti-overcounting check.
        </>
      }
      headline={
        <Headline
          label="Organic activity ratio"
          value={pct1(ratio?.current)}
          previous={pct1(ratio?.previous)}
          delta={fmtPts(ratio?.deltaPts ?? null)}
          deltaValue={ratio?.deltaPts ?? null}
          definition={DEFINITIONS.q2_organic_ratio}
          aside={
            counts ? (
              <>
                {fmtInt(counts.interactive)} interactive · {fmtInt(counts.automated)} automated
                {counts.other > 0 ? ` · ${fmtInt(counts.other)} uncategorized` : ""} · {fmtInt(counts.total)} total actions
              </>
            ) : undefined
          }
        />
      }
      detailLabel="Offer detail — by source, instance, maker, invocation target; give / want value; outcome totals"
      detail={
        <>
          {offers && (
            <div>
              <h3 className={IN_CARD_TITLE_CLASS}>Settled outcomes (all categories)</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard title="Settled offers" subtitle="Zoe offers reaching terminal payout in range" current={offers.outcomes.settled.current} previous={offers.outcomes.settled.previous} pct={offers.outcomes.settled.pctChange} />
                <KpiCard title="Wants satisfied" subtitle="numWantsSatisfied ≥ 1" current={offers.outcomes.wantsSatisfied.current} previous={offers.outcomes.wantsSatisfied.previous} pct={offers.outcomes.wantsSatisfied.pctChange} />
                <KpiCard title="Refunded / unsatisfied" subtitle="numWantsSatisfied === 0 (give refunded)" current={offers.outcomes.wantsUnsatisfied.current} previous={offers.outcomes.wantsUnsatisfied.previous} pct={offers.outcomes.wantsUnsatisfied.pctChange} />
                <KpiCard title="Errored" subtitle="Settled status carrying an error" current={offers.outcomes.errored.current} previous={offers.outcomes.errored.previous} pct={offers.outcomes.errored.pctChange} />
              </div>
            </div>
          )}
          {offers && (
            <div className="grid gap-4 lg:grid-cols-2">
              <OfferLabeledTable title="By target contract (instance)" hint="Zoe offers by target Instance (Board id → agoricNames label). Continuing offers carry no instance and are omitted here." colLabel="Instance" rows={offers.byInstance} />
              <OfferLabeledTable title="By invitation maker" hint="publicInvitationMaker / invitationMakerName / callPipe[0] across offer sources." colLabel="Maker" rows={offers.byMaker} />
              <OfferLabeledTable title="By invocation target" hint="invokeEntry handlers (orchestration), not Zoe offers." colLabel="Target" rows={offers.byTarget} />
              <OfferLabeledTable title="By invitation source" hint="contract / agoricContract / continuing / purse." colLabel="Source" rows={offers.bySource} />
            </div>
          )}
          {offers && (
            <div className={CARD_CLASS}>
              <h3 className={IN_CARD_TITLE_CLASS}>Offer value by asset — payouts, give, want</h3>
              <p className="mb-3 text-xs leading-snug text-[var(--muted)]">
                <strong className="font-medium text-[var(--color-text-secondary)]">Payouts</strong> is what settled offers
                returned (primary). Give and want are proposal intent; they overlap payouts (give is refunded into
                payouts) — do not add columns. USD is day-priced; only vbank-recognized assets are valued.
                {data.offerValueUsd && <UsdBasisNote meta={data.offerValueUsd.usdPricingMeta} />}
              </p>
              {valueRows.length === 0 ? (
                <OfferEmpty />
              ) : (
                <div className="min-w-0 max-w-full overflow-x-auto">
                  <table className={TABLE_CLASS}>
                    <thead>
                      <tr className={TABLE_HEAD_ROW_CLASS}>
                        <th className="py-2 pr-4 font-semibold">Asset</th>
                        <th className="py-2 pr-4 text-right font-semibold">Payouts</th>
                        <th className="py-2 pr-4 text-right font-semibold">Payouts USD</th>
                        <th className="py-2 pr-4 text-right font-semibold">Give</th>
                        <th className="py-2 pr-4 text-right font-semibold">Give USD</th>
                        <th className="py-2 pr-4 text-right font-semibold">Want</th>
                        <th className="py-2 text-right font-semibold">Want USD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {valueRows.map((r) => (
                        <tr key={r.denom} className={TABLE_ROW_CLASS}>
                          <td className="py-1.5 pr-4 font-mono text-[var(--text)]">{r.symbol}</td>
                          <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-[var(--text)]">{r.payoutNative}</td>
                          <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-[var(--text)]">{r.payoutUsd ?? "—"}</td>
                          <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-[var(--muted)]">{r.giveNative}</td>
                          <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-[var(--muted)]">{r.giveUsd ?? "—"}</td>
                          <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-[var(--muted)]">{r.wantNative}</td>
                          <td className="py-1.5 text-right font-mono tabular-nums text-[var(--muted)]">{r.wantUsd ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-[var(--border)] font-semibold">
                        <td className="py-2 pr-4 text-[var(--color-text-secondary)]">TOTAL (priced rows)</td>
                        <td className="py-2 pr-4 text-center text-[var(--muted)]">—</td>
                        <td className="py-2 pr-4 text-right font-mono tabular-nums">{data.offerValueUsd?.payouts.total ?? "—"}</td>
                        <td className="py-2 pr-4 text-center text-[var(--muted)]">—</td>
                        <td className="py-2 pr-4 text-right font-mono tabular-nums text-[var(--muted)]">{data.offerValueUsd?.give.total ?? "—"}</td>
                        <td className="py-2 pr-4 text-center text-[var(--muted)]">—</td>
                        <td className="py-2 text-right font-mono tabular-nums text-[var(--muted)]">{data.offerValueUsd?.want.total ?? "—"}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      }
    >
      {hasActivity ? (
        <OffersActivityLineChart data={chartRows} timeAxis={timeAxis} />
      ) : (
        <div className={CARD_CLASS}>
          <OfferEmpty />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <SupportFigure
          label="Distinct interactive wallets"
          value={walletsAvailable ? fmtInt(q?.support.distinctInteractiveWallets.current ?? null) : "—"}
          previous={walletsAvailable ? fmtInt(q?.support.distinctInteractiveWallets.previous ?? null) : undefined}
          delta={walletsAvailable ? fmtPct(q?.support.distinctInteractiveWallets.pctChange ?? null) : undefined}
          deltaValue={q?.support.distinctInteractiveWallets.pctChange ?? null}
          definition={DEFINITIONS.q2_distinct_interactive_wallets}
          note={walletsAvailable ? undefined : "Available after the offer-category backfill."}
        />
        <SupportFigure
          label="Distinct automated wallets"
          value={walletsAvailable ? fmtInt(q?.support.distinctAutomatedWallets.current ?? null) : "—"}
          previous={walletsAvailable ? fmtInt(q?.support.distinctAutomatedWallets.previous ?? null) : undefined}
          delta={walletsAvailable ? fmtPct(q?.support.distinctAutomatedWallets.pctChange ?? null) : undefined}
          deltaValue={q?.support.distinctAutomatedWallets.pctChange ?? null}
          definition={DEFINITIONS.q2_distinct_automated_wallets}
          note={walletsAvailable ? undefined : "Available after the offer-category backfill."}
        />
        <SupportFigure
          label="Satisfaction rate (all offers)"
          value={pct1(offers?.outcomes.satisfactionRatePct)}
          definition={DEFINITIONS.q2_satisfaction_rate}
          note={offers ? `${offers.outcomes.settled.current} settled in range` : undefined}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={CARD_CLASS}>
          <h3 className={IN_CARD_TITLE_CLASS}>Satisfaction by category</h3>
          <p className="mb-3 text-xs leading-snug text-[var(--muted)]">
            Settled offers per functional category and the share that got what they asked for. A product health signal:
            vault and PSM offers should settle satisfied; auctions and liquidations legitimately do not.
          </p>
          {sat.length === 0 ? (
            <EmptyNote>No settled offers by category in range (populates after the offer-category backfill).</EmptyNote>
          ) : (
            <table className={TABLE_CLASS}>
              <thead>
                <tr className={TABLE_HEAD_ROW_CLASS}>
                  <th className="py-2 pr-4 font-semibold">Category</th>
                  <th className="py-2 pr-4 text-right font-semibold">Settled</th>
                  <th className="py-2 pr-4 text-right font-semibold">Satisfied</th>
                  <th className="py-2 pr-4 text-right font-semibold">Refunded</th>
                  <th className="py-2 pr-4 text-right font-semibold">Errored</th>
                  <th className="py-2 text-right font-semibold">Rate</th>
                </tr>
              </thead>
              <tbody>
                {sat.map((r) => (
                  <tr key={r.category} className={TABLE_ROW_CLASS}>
                    <td className="py-1.5 pr-4 font-mono text-[var(--text)]">{r.category}</td>
                    <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-[var(--text)]">{fmtInt(r.settled)}</td>
                    <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-[var(--text)]">{fmtInt(r.wantsSatisfied)}</td>
                    <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-[var(--muted)]">{fmtInt(r.wantsUnsatisfied)}</td>
                    <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-[var(--muted)]">{fmtInt(r.errored)}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-[var(--text)]">{pct1(r.satisfactionRatePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {offers && <OfferCategoryTable rows={offers.byCategory} />}
      </div>
    </QuestionBlock>
  );
}
