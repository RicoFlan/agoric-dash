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
  fmtPct1,
  fmtPts,
  Headline,
  IN_CARD_TITLE_CLASS,
  InfoHint,
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
import { buildVerdicts } from "@/lib/narrative";
import { DEFINITIONS } from "@/lib/definitions";
import { buildOffersActivityRows } from "@/lib/offersActivitySeries";
import type { QuestionsPayload } from "@/lib/questionsPayload";

type XAxisSpread = ComponentProps<typeof XAxis>;

const OffersActivityLineChart = dynamic(() => import("@/components/dashboard/charts/OffersActivityLineChart"), {
  loading: () => <ChartChunkFallback title="Smart-wallet offer activity" />,
  ssr: false,
});

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
  /**
   * Coverage caveat for the headline: unclassified actions are in its DENOMINATOR, so the true
   * user-initiated share lies between the printed ratio and the ratio plus this share. Null (not 0)
   * when nothing was categorized in range.
   */
  const unclassifiedPct = q?.support.unclassifiedSharePct ?? null;
  const organicUpperPct = ratio?.current != null && unclassifiedPct !== null ? ratio.current + unclassifiedPct : null;
  const engagement = offers?.engagement;
  const sat = q?.support.satisfactionByCategory ?? [];
  const walletsAvailable = q?.support.available ?? false;

  const verdict = useMemo(
    () => (data.questions ? buildVerdicts(data.questions).find((v) => v.id === "organic") : undefined),
    [data.questions]
  );

  return (
    <QuestionBlock
      id={dashboardSectionIds.organic}
      eyebrow="Q2"
      title="Is usage becoming more organic?"
      verdict={verdict}
      intro={
        <>
          Most Agoric activity is smart-wallet intent (Zoe offers and invocations), and a few automation wallets submit most
          of it. The organic ratio is the share of wallet actions in user-initiated categories — over indexed history that
          is almost entirely YMax (portfolio offers, EVM-wallet deposits) with a small PSM remainder — versus automated ones
          (fast-USDC settlement, the YMax planner and other orchestration, oracle price feeds). The vaults, auction and
          governance categories are grouped as user-initiated too, but have recorded zero actions: Inter Protocol was sunset
          on 30 June 2025, before indexed history begins. Distinct user-initiated wallets is the anti-overcounting check,
          and the unclassified share is how much of the denominator no rule could place.
        </>
      }
      headline={
        <Headline
          label="User-initiated share of wallet actions"
          value={fmtPct1(ratio?.current)}
          previous={fmtPct1(ratio?.previous)}
          delta={fmtPts(ratio?.deltaPts ?? null)}
          deltaValue={ratio?.deltaPts ?? null}
          definition={DEFINITIONS.q2_organic_ratio}
          aside={
            counts ? (
              <>
                {fmtInt(counts.interactive)} user-initiated · {fmtInt(counts.automated)} automated
                {counts.other > 0 ? ` · ${fmtInt(counts.other)} unclassified` : ""} · {fmtInt(counts.total)} total actions
                <br />
                <span className={unclassifiedPct !== null && unclassifiedPct > 0 ? "font-semibold text-[var(--color-warning)]" : undefined}>
                  {unclassifiedPct === null
                    ? "Category coverage unknown — no actions categorized in range."
                    : `${fmtPct1(unclassifiedPct)} of actions could not be classified`}
                  <InfoHint text={DEFINITIONS.q2_unclassified_share} />
                </span>
                {organicUpperPct !== null && unclassifiedPct !== null && unclassifiedPct > 0 && (
                  <>
                    {" "}
                    — they stay in the denominator, so the user-initiated share is between{" "}
                    {fmtPct1(ratio?.current ?? null)} and {fmtPct1(organicUpperPct)}.
                  </>
                )}
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
              <h3 className={IN_CARD_TITLE_CLASS}>Offer outcomes (all categories)</h3>
              <p className="mb-3 text-xs leading-snug text-[var(--muted)]">
                Settled states are <strong className="font-medium text-[var(--color-text-secondary)]">not</strong>{" "}
                exhaustive: an offer can stay live indefinitely with the seat open and no error published
                anywhere, a transaction can succeed while its offer is rejected later, and an offer made near
                the end of the range may simply not have settled yet.{" "}
                <em>Unresolved</em> is the range residual, offers seen minus offers settled — a windowing
                figure, not a lifecycle state. It goes negative when an offer made before the range settles
                inside it.
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <KpiCard title="Offers seen" subtitle="Zoe offers submitted in range (executeOffer / tryExitOffer)" current={offers.outcomes.offersSeen.current} previous={offers.outcomes.offersSeen.previous} pct={offers.outcomes.offersSeen.pctChange} />
                <KpiCard title="Settled offers" subtitle="Zoe offers reaching terminal payout in range" current={offers.outcomes.settled.current} previous={offers.outcomes.settled.previous} pct={offers.outcomes.settled.pctChange} />
                <KpiCard title="Unresolved" subtitle="Range residual of seen − settled. Not failed; negative at a range edge." current={offers.outcomes.unresolved.current} previous={offers.outcomes.unresolved.previous} pct={offers.outcomes.unresolved.pctChange} definition={DEFINITIONS.q2_unresolved_offers} upIsGood={false} />
                <KpiCard title="Wants satisfied" subtitle="numWantsSatisfied ≥ 1" current={offers.outcomes.wantsSatisfied.current} previous={offers.outcomes.wantsSatisfied.previous} pct={offers.outcomes.wantsSatisfied.pctChange} />
                <KpiCard title="Refunded / unsatisfied" subtitle="numWantsSatisfied === 0 (give refunded)" current={offers.outcomes.wantsUnsatisfied.current} previous={offers.outcomes.wantsUnsatisfied.previous} pct={offers.outcomes.wantsUnsatisfied.pctChange} upIsGood={false} />
                <KpiCard title="Errored" subtitle="Settled status carrying an error" current={offers.outcomes.errored.current} previous={offers.outcomes.errored.previous} pct={offers.outcomes.errored.pctChange} upIsGood={false} />
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SupportFigure
          label="User-initiated share of wallets"
          value={walletsAvailable ? fmtPct1(q?.support.walletWeightedPct.current ?? null) : "—"}
          previous={walletsAvailable ? fmtPct1(q?.support.walletWeightedPct.previous ?? null) : undefined}
          delta={walletsAvailable ? fmtPts(q?.support.walletWeightedPct.deltaPts ?? null) : undefined}
          deltaValue={q?.support.walletWeightedPct.deltaPts ?? null}
          definition={DEFINITIONS.q2_wallet_weighted_organic}
          note={
            walletsAvailable
              ? q?.support.categorizedWallets != null
                ? `${fmtInt(q.support.distinctInteractiveWallets.current)} of ${fmtInt(q.support.categorizedWallets)} wallets; ${fmtInt(q.support.mixedWallets)} acted in both groups`
                : undefined
              : "Available after the offer-category backfill."
          }
        />
        <SupportFigure
          label="Distinct user-initiated wallets"
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
          label="Continuing offers"
          value={engagement ? fmtPct1(engagement.continuingSharePct) : "—"}
          definition={DEFINITIONS.q2_continuing_share}
          note={
            engagement
              ? `${fmtInt(Number(engagement.continuing))} on an existing seat, ${fmtInt(Number(engagement.fresh))} from a fresh invitation` +
                (Number(engagement.unknown) > 0 ? `; ${fmtInt(Number(engagement.unknown))} of unknown source excluded` : "")
              : undefined
          }
        />
        <SupportFigure
          label="Declared-wants fulfillment"
          value={fmtPct1(offers?.outcomes.satisfactionRatePct)}
          definition={DEFINITIONS.q2_satisfaction_rate}
          note={offers ? `${fmtInt(Number(offers.outcomes.wantsSatisfied.current))} of ${fmtInt(Number(offers.outcomes.settled.current))} settled offers` : undefined}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={CARD_CLASS}>
          <h3 className={IN_CARD_TITLE_CLASS}>Satisfaction by category</h3>
          <p className="mb-3 text-xs leading-snug text-[var(--muted)]">
            Settled offers per functional category and the share that got what they asked for. A product health signal,
            read per category: a YMax portfolio offer or a PSM swap should settle satisfied, while an auction bid
            legitimately may not. Categories with no activity in range are absent here rather than shown as zero.
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
                    <td className="py-1.5 text-right font-mono tabular-nums text-[var(--text)]">{fmtPct1(r.satisfactionRatePct)}</td>
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
