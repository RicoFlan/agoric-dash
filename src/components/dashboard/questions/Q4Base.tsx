"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { ChartChunkFallback } from "@/components/dashboard/ChartChunkFallback";
import {
  CARD_CLASS,
  EmptyNote,
  fmtInt,
  fmtNum,
  fmtPct,
  fmtPct1,
  fmtPts,
  Headline,
  IN_CARD_TITLE_CLASS,
  KpiCardLite,
  QuestionBlock,
  SupportFigure,
  TABLE_CLASS,
  TABLE_HEAD_ROW_CLASS,
  TABLE_ROW_CLASS,
} from "@/components/dashboard/primitives";
import type { MetricsPayload } from "@/components/dashboard/types";
import { UsdBasisNote } from "@/components/dashboard/UsdBasisNote";
import { chartTheme } from "@/lib/chartTheme";
import { effectiveNumberFromHhi } from "@/lib/concentrationMath";
import { dashboardSectionIds } from "@/lib/dashboardNav";
import { ubldToWholeBld } from "@/lib/provisioningSeries";
import { buildVerdicts } from "@/lib/narrative";
import { DEFINITIONS } from "@/lib/definitions";
import { filledDistinctAccountsPerDay } from "@/lib/filledDistinctAccountsSeries";
import { INDEXED_HISTORY_FROM_DAY } from "@/lib/semantics";
import type { QuestionsPayload } from "@/lib/questionsPayload";

const EffectiveNLineChart = dynamic(() => import("@/components/dashboard/charts/EffectiveNLineChart"), {
  loading: () => <ChartChunkFallback title="Breadth of the economic base" />,
  ssr: false,
});
const DistinctAccountsLineChart = dynamic(() => import("@/components/dashboard/charts/DistinctAccountsLineChart"), {
  loading: () => <ChartChunkFallback title="Distinct account addresses" />,
  ssr: false,
});

/** Day-keyed X axis for daily-grain charts (independent of the selected granularity). */
function dayAxis(n: number, dataKey: "day" | "bucket") {
  const dense = n > 31;
  return {
    dataKey,
    tick: { fill: chartTheme.axisTick, fontSize: dense ? 9 : 11 },
    ...(dense ? { height: 58, angle: -32, textAnchor: "end" as const, interval: "preserveStartEnd" as const, minTickGap: 4 } : {}),
    tickFormatter: (v: string) => {
      const d = new Date(`${v.slice(0, 10)}T12:00:00.000Z`);
      if (Number.isNaN(d.getTime())) return v;
      return `${(d.getUTCMonth() + 1).toString().padStart(2, "0")}/${d.getUTCDate().toString().padStart(2, "0")}`;
    },
  };
}

/** Q4 — Is the economic base broadening or concentrating? Headline: effective number of fee payers. */
export function Q4Base({
  data,
  q,
  from,
  to,
}: {
  data: MetricsPayload;
  q: QuestionsPayload["q4"] | undefined;
  from: string;
  to: string;
}) {
  const chartRows = useMemo(
    () =>
      (data.concentrationOverTime ?? []).map((p) => ({
        day: p.day,
        effectiveNFee: effectiveNumberFromHhi(p.feesUsdHhi),
        effectiveNGross: effectiveNumberFromHhi(p.grossUsdHhi),
        top10FeeSharePct: p.top10ShareFeesUsdPct,
      })),
    [data.concentrationOverTime]
  );
  const hasTrend = chartRows.some((r) => r.effectiveNFee !== null || r.effectiveNGross !== null);
  const accountsRows = useMemo(() => {
    const sparse = data.participation?.distinctUnionPerDay;
    return sparse ? filledDistinctAccountsPerDay(from, to, sparse) : [];
  }, [from, to, data.participation?.distinctUnionPerDay]);

  const r = q?.retention;
  const prov = q?.provisioning;
  const p = data.participation;
  const c = data.concentration;

  const verdict = useMemo(
    () => (data.questions ? buildVerdicts(data.questions).find((v) => v.id === "base") : undefined),
    [data.questions]
  );

  return (
    <QuestionBlock
      id={dashboardSectionIds.base}
      eyebrow="Q4"
      title="Is the economic base broadening or concentrating?"
      verdict={verdict}
      intro={
        <>
          Two different questions, kept apart. <strong className="font-medium text-[var(--color-text-primary)]">Participation</strong> is
          who showed up. <strong className="font-medium text-[var(--color-text-primary)]">Fee funding</strong> is who paid, measured on
          the basis hardest to fake, and it is what the headline reports: the effective number of fee payers is how many
          equally-active payers would produce the observed concentration (1 ÷ HHI of day-priced fee USD). A broad user
          base funded by one sponsor reads as concentrated here, so read it as fee concentration and not as the size of
          the economic base. Module accounts are excluded; addresses are not people.
        </>
      }
      headline={
        <Headline
          label="Effective number of fee payers"
          value={fmtNum(q?.headline.current ?? null, 1)}
          previous={fmtNum(q?.headline.previous ?? null, 1)}
          delta={fmtPct(q?.headline.pctChange ?? null)}
          deltaValue={q?.headline.pctChange ?? null}
          definition={DEFINITIONS.q4_effective_fee_payers}
          aside={
            q ? (
              <>
                Gross-movement basis: {fmtNum(q.effectiveNGross, 1)} effective addresses · top-10 fee share{" "}
                {fmtPct1(q.support.top10FeeSharePct)}
                <UsdBasisNote meta={q.usdPricingMeta} />
              </>
            ) : undefined
          }
        />
      }
      detailLabel="Participation detail — signers, fee payers, raw HHI, distinct accounts per day"
      detail={
        <>
          {p && c && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCardLite title="Distinct signers (range)" subtitle="Unique signer addresses (multi-signer txs count each pubkey)" value={fmtInt(Number(p.distinctSigners))} />
              <KpiCardLite title="Distinct fee payers (range)" subtitle="Unique resolved fee payers — not deduped vs signers" value={fmtInt(Number(p.distinctFeePayers))} />
              <KpiCardLite title="Active 1 day only" subtitle="Calendar days with any signer/fee role" value={fmtInt(Number(p.singleDayInRange))} />
              <KpiCardLite title="Active 2+ days" subtitle="Returning within the selected window" value={fmtInt(Number(p.multiDayInRange))} />
              <KpiCardLite title="Top-10 gross USD share" subtitle="Sender-attributed transfer legs, day-priced" value={c.top10AddressShareGrossUsd ?? "—"} />
              <KpiCardLite title="Top-10 fee USD share" subtitle="Paid fees by resolved fee payer, day-priced" value={c.top10AddressShareFeesUsd ?? "—"} />
              <KpiCardLite title="Gross USD HHI (0–1)" subtitle="Raw Herfindahl index; effective N = 1 ÷ HHI" value={c.grossUsdHhi ?? "—"} />
              <KpiCardLite title="Fee USD HHI (0–1)" subtitle="Raw Herfindahl index; effective N = 1 ÷ HHI" value={c.feesUsdHhi ?? "—"} />
            </div>
          )}
          {accountsRows.length > 0 && <DistinctAccountsLineChart data={accountsRows} timeAxis={dayAxis(accountsRows.length, "bucket")} />}
          {p && p.distinctUnionPerDay.length > 0 && (
            <div className={CARD_CLASS}>
              <h3 className={IN_CARD_TITLE_CLASS}>Distinct account addresses per calendar day</h3>
              <div className="max-h-72 overflow-y-auto">
                <table className={TABLE_CLASS}>
                  <thead>
                    <tr className={TABLE_HEAD_ROW_CLASS}>
                      <th className="py-2 pr-4 font-semibold">UTC day</th>
                      <th className="py-2 font-semibold">Distinct addresses</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.distinctUnionPerDay.map((row) => (
                      <tr key={row.day} className={TABLE_ROW_CLASS}>
                        <td className="py-1.5 pr-4 font-mono text-[var(--text)]">{row.day}</td>
                        <td className="py-1.5 font-mono tabular-nums text-[var(--text)]">{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      }
    >
      {hasTrend ? (
        <EffectiveNLineChart data={chartRows} timeAxis={dayAxis(chartRows.length, "day")} />
      ) : (
        <div className={CARD_CLASS}>
          <EmptyNote>No priced fee or transfer activity in range to compute concentration.</EmptyNote>
        </div>
      )}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Participation</h3>
        <p className="mb-3 text-xs leading-snug text-[var(--muted)]">Who showed up, independent of who paid for it.</p>
        <div className="grid gap-4 sm:grid-cols-3">
        <SupportFigure
          label="Retained addresses"
          value={fmtPct1(r?.current.retainedSharePct)}
          previous={r ? fmtPct1(r.previous.retainedSharePct) : undefined}
          delta={r ? fmtPts(r.retainedShareDeltaPts) : undefined}
          deltaValue={r?.retainedShareDeltaPts ?? null}
          definition={DEFINITIONS.q4_retained_addresses}
          note={r ? `${fmtInt(r.current.retained)} of ${fmtInt(r.current.active)} active` : undefined}
        />
        <SupportFigure
          label={`First seen since ${INDEXED_HISTORY_FROM_DAY}`}
          value={fmtPct1(r?.current.newSharePct)}
          previous={r ? fmtPct1(r.previous.newSharePct) : undefined}
          definition={DEFINITIONS.q4_new_addresses}
          note={r ? `${fmtInt(r.current.newAddresses)} first seen` : undefined}
        />
        <SupportFigure
          label="Active 2+ days"
          value={fmtInt(q?.support.multiDayInRange ?? (p ? Number(p.multiDayInRange) : null))}
          definition={DEFINITIONS.q4_active_multi_day}
        />
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
          New smart wallets
        </h3>
        <p className="mb-3 text-xs leading-snug text-[var(--muted)]">
          From the provision pool&apos;s own counters. The one participation figure here a single actor cannot inflate:
          provisioning charges a real fee, so the count is bounded by spend rather than by how many addresses someone
          cares to create.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <SupportFigure
            label="Wallets provisioned"
            value={prov?.available ? fmtInt(prov.summary.newWallets) : "—"}
            definition={DEFINITIONS.q4_new_wallets_provisioned}
            note={
              prov?.available
                ? prov.summary.closingWalletsProvisioned !== null
                  ? `${fmtInt(prov.summary.closingWalletsProvisioned)} since genesis`
                  : undefined
                : prov?.unavailableReason === "range-exceeds-coverage"
                  ? `Backfilled only through ${prov.coveredThroughDay}; this range extends past it.`
                  : "Available after the provision-pool backfill."
            }
          />
          <SupportFigure
            label="Pool minted (BLD)"
            value={
              prov?.available && prov.summary.mintedUbld !== null
                ? Number(ubldToWholeBld(prov.summary.mintedUbld)).toLocaleString("en-US")
                : "—"
            }
            definition={DEFINITIONS.q4_provisioning_funding}
            note="Pool funding, not the cost of those wallets"
          />
          <SupportFigure
            label="Days off the 10 BLD fee"
            value={prov?.available ? `${prov.summary.daysOffFee} of ${prov.summary.daysRateChecked}` : "—"}
            definition={DEFINITIONS.q4_provisioning_funding}
            upIsGood={false}
            note={
              prov?.available && prov.summary.daysOffFee > 0
                ? "Minting and provisioning are decoupled; expected, not an error"
                : undefined
            }
          />
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Fee funding</h3>
        <p className="mb-3 text-xs leading-snug text-[var(--muted)]">
          Who paid for that activity. This is not the same population: a fee grant makes one granter pay for many users,
          which reads here as concentration even when participation is broad.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <SupportFigure
            label="Distinct fee payers"
            value={fmtInt(p ? Number(p.distinctFeePayers) : null)}
            definition={DEFINITIONS.q4_distinct_fee_payers}
          />
          <SupportFigure
            label="Effective fee payers"
            value={fmtNum(q?.headline.current ?? null, 1)}
            definition={DEFINITIONS.q4_effective_fee_payers}
            note="1 ÷ HHI of day-priced fee USD"
          />
          <SupportFigure
            label="Top-10 fee share"
            value={fmtPct1(q?.support.top10FeeSharePct)}
            definition={DEFINITIONS.q4_top10_fee_share}
            upIsGood={false}
          />
        </div>
      </div>
    </QuestionBlock>
  );
}
