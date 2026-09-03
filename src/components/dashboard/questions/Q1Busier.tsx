"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import { useMemo } from "react";
import type { XAxis } from "recharts";
import { ChartChunkFallback } from "@/components/dashboard/ChartChunkFallback";
import {
  fmtInt,
  fmtNum,
  fmtPct,
  Headline,
  IN_CARD_TITLE_CLASS,
  KpiCard,
  KpiCardLite,
  QuestionBlock,
  SupportFigure,
} from "@/components/dashboard/primitives";
import type { Granularity, MetricsPayload } from "@/components/dashboard/types";
import { atomicToHumanString } from "@/lib/amountFormat";
import { dashboardSectionIds } from "@/lib/dashboardNav";
import { DEFINITIONS } from "@/lib/definitions";
import { buildGasUtilizationRows } from "@/lib/gasUtilizationSeries";
import type { QuestionsPayload } from "@/lib/questionsPayload";
import { FEE_DENOM_UBLB, INDEXER_SCOPE_CAVEAT_SUBTITLE } from "@/lib/semantics";
import { buildStakingGovActivityRows } from "@/lib/stakingGovActivitySeries";
import { buildSuccessRateRows } from "@/lib/successRateSeries";
import { formatRatePct } from "@/lib/txSuccessRate";

type XAxisSpread = ComponentProps<typeof XAxis>;

const TxActivityLineChart = dynamic(() => import("@/components/dashboard/charts/TxActivityLineChart"), {
  loading: () => <ChartChunkFallback title="Successful transactions" />,
  ssr: false,
});
const IbcTrafficLineChart = dynamic(() => import("@/components/dashboard/charts/IbcTrafficLineChart"), {
  loading: () => <ChartChunkFallback title="IBC traffic" />,
  ssr: false,
});
const TxSuccessRateLineChart = dynamic(() => import("@/components/dashboard/charts/TxSuccessRateLineChart"), {
  loading: () => <ChartChunkFallback title="Transaction success rate" />,
  ssr: false,
});
const GasUtilizationLineChart = dynamic(() => import("@/components/dashboard/charts/GasUtilizationLineChart"), {
  loading: () => <ChartChunkFallback title="Block-space utilization" />,
  ssr: false,
});
const StakingGovActivityLineChart = dynamic(() => import("@/components/dashboard/charts/StakingGovActivityLineChart"), {
  loading: () => <ChartChunkFallback title="Staking & governance activity" />,
  ssr: false,
});

function finiteN(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

/** Q1 — Is the chain busier? Headline: successful txs vs the prior window. */
export function Q1Busier({
  data,
  q,
  granularity,
  timeAxis,
}: {
  data: MetricsPayload;
  q: QuestionsPayload["q1"] | undefined;
  granularity: Granularity;
  timeAxis: XAxisSpread;
}) {
  const chartTx = useMemo(
    () => (data.series?.txTotal ?? []).map((r) => ({ bucket: r.bucket, successfulTx: finiteN(Number(r.value)) })),
    [data.series?.txTotal]
  );
  const chartIbcTraffic = useMemo(() => {
    const o = data.series?.ibcOutboundMsgs ?? [];
    const i = data.series?.ibcInboundRecvFlows ?? [];
    const outM = new Map(o.map((r) => [r.bucket, finiteN(Number(r.value))]));
    const inM = new Map(i.map((r) => [r.bucket, finiteN(Number(r.value))]));
    const keys = [...new Set([...outM.keys(), ...inM.keys()])].sort();
    return keys.map((bucket) => ({ bucket, out: outM.get(bucket) ?? 0, recv: inM.get(bucket) ?? 0 }));
  }, [data.series?.ibcOutboundMsgs, data.series?.ibcInboundRecvFlows]);
  const chartSuccessRate = useMemo(
    () => (data.series ? buildSuccessRateRows(data.series.txTotal ?? [], data.series.txFailed ?? []) : []),
    [data.series]
  );
  const chartGasUtilization = useMemo(
    () =>
      data.series
        ? buildGasUtilizationRows(data.series.gasUsed ?? [], data.series.gasWanted ?? [], data.series.blockGasLimit ?? [])
        : [],
    [data.series]
  );
  const chartStakingGov = useMemo(() => {
    const sg = data.series?.stakingGov;
    if (!sg) return [];
    return buildStakingGovActivityRows({
      delegations: sg.delegations ?? [],
      undelegations: sg.undelegations ?? [],
      redelegations: sg.redelegations ?? [],
      govVotes: sg.govVotes ?? [],
      govProposals: sg.govProposals ?? [],
    });
  }, [data.series?.stakingGov]);

  const k = data.kpis;
  const bld = (atomic: string) => (/^\d+$/.test(atomic) ? `${atomicToHumanString(atomic, 6)} BLD` : "—");
  const flagged = q?.anomalies ?? [];

  return (
    <QuestionBlock
      id={dashboardSectionIds.busier}
      eyebrow="Q1"
      title="Is the chain busier?"
      intro={
        <>
          Successful transactions on agoric-3 (whole txs with ABCI code 0), compared with an equal-length window ending just
          before <strong className="font-medium text-[var(--color-text-primary)]">From</strong>. Txs are not users — see
          Q4 for addresses. {INDEXER_SCOPE_CAVEAT_SUBTITLE}
        </>
      }
      headline={
        <Headline
          label="Successful transactions"
          value={fmtInt(q?.headline.current ?? Number(k.txSuccess.current))}
          previous={fmtInt(q?.headline.previous ?? Number(k.txSuccess.previous))}
          delta={fmtPct(q?.headline.pctChange ?? k.txSuccess.pctChange)}
          deltaValue={q?.headline.pctChange ?? k.txSuccess.pctChange}
          definition={DEFINITIONS.q1_successful_txs}
          aside={
            flagged.length > 0 ? (
              <>
                <span className="font-semibold text-[var(--color-text-secondary)]">
                  {flagged.length} unusual day{flagged.length === 1 ? "" : "s"}
                </span>
                : {flagged.slice(0, 3).map((a) => `${a.day.slice(5)} (${a.direction}, z ${a.z.toFixed(1)})`).join(", ")}
                {flagged.length > 3 ? ", …" : ""}
              </>
            ) : q ? (
              "No unusual days vs the trailing 30 days."
            ) : undefined
          }
        />
      }
      detailLabel="Network detail — gas, fees, IBC counts, staking & governance, success rate"
      detail={
        <>
          <div>
            <h3 className={IN_CARD_TITLE_CLASS}>Gas and fees</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <KpiCard title="Gas used" subtitle={`ABCI gas units (successful + failed inclusions); not a token. ${INDEXER_SCOPE_CAVEAT_SUBTITLE}`} current={k.gasUsed.current} previous={k.gasUsed.previous} pct={k.gasUsed.pctChange} />
              <KpiCard title="Gas wanted" subtitle="ABCI gas units requested (successful + failed)." current={k.gasWanted.current} previous={k.gasWanted.previous} pct={k.gasWanted.pctChange} />
              <KpiCardLite title="Gas efficiency" subtitle={`Gas used ÷ gas wanted · prior window: ${formatRatePct(k.gasEfficiencyPct.previous)}`} value={formatRatePct(k.gasEfficiencyPct.current)} />
              <KpiCardLite title="Block-space utilization" subtitle={`Gas used ÷ consensus block gas limit (max_gas) · prior window: ${formatRatePct(k.blockGasUtilizationPct.previous)}`} value={formatRatePct(k.blockGasUtilizationPct.current)} />
              <KpiCard title="Paid fees (all denoms, raw)" subtitle={`On-chain paid fee totals summed across denoms in minimal units (${FEE_DENOM_UBLB} dominates); successful txs only.`} current={k.feesPaidAllDenoms.current} previous={k.feesPaidAllDenoms.previous} pct={k.feesPaidAllDenoms.pctChange} />
              <KpiCard title="Failed txs" subtitle="Included but reverted (ABCI ≠ 0); consume gas, pay no fee_paid" current={k.txFailed.current} previous={k.txFailed.previous} pct={k.txFailed.pctChange} />
            </div>
          </div>
          {chartGasUtilization.length > 0 && <GasUtilizationLineChart data={chartGasUtilization} timeAxis={timeAxis} />}
          {chartSuccessRate.length > 0 && <TxSuccessRateLineChart data={chartSuccessRate} timeAxis={timeAxis} />}
          <div>
            <h3 className={IN_CARD_TITLE_CLASS}>IBC message counts</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <KpiCard title="IBC outbound messages" subtitle="MsgTransfer count (several per tx possible)" current={k.ibcOutboundMsgCount.current} previous={k.ibcOutboundMsgCount.previous} pct={k.ibcOutboundMsgCount.pctChange} />
              <KpiCard title="IBC inbound (recv flows)" subtitle="ibc_transfer_flow_in when indexed; else MsgRecvPacket msgs" current={k.ibcInboundRecvFlowCount.current} previous={k.ibcInboundRecvFlowCount.previous} pct={k.ibcInboundRecvFlowCount.pctChange} />
            </div>
          </div>
          <IbcTrafficLineChart data={chartIbcTraffic} timeAxis={timeAxis} />
          <div>
            <h3 className={IN_CARD_TITLE_CLASS}>Staking &amp; governance</h3>
            <p className="mb-3 text-xs leading-snug text-[var(--muted)]">
              Message counts in successful txs (one message = one action). Top-level messages only — actions wrapped in
              authz <code>MsgExec</code> are not counted.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <KpiCard title="Delegations" subtitle="MsgDelegate count" current={k.stakingDelegations.current} previous={k.stakingDelegations.previous} pct={k.stakingDelegations.pctChange} />
              <KpiCard title="Undelegations" subtitle="MsgUndelegate count" current={k.stakingUndelegations.current} previous={k.stakingUndelegations.previous} pct={k.stakingUndelegations.pctChange} />
              <KpiCard title="Redelegations" subtitle="MsgBeginRedelegate count" current={k.stakingRedelegations.current} previous={k.stakingRedelegations.previous} pct={k.stakingRedelegations.pctChange} />
              <KpiCard title="Governance votes" subtitle="MsgVote / MsgVoteWeighted (gov v1 + v1beta1)" current={k.govVotes.current} previous={k.govVotes.previous} pct={k.govVotes.pctChange} />
              <KpiCard title="Proposals submitted" subtitle="MsgSubmitProposal (gov v1 + v1beta1)" current={k.govProposals.current} previous={k.govProposals.previous} pct={k.govProposals.pctChange} />
            </div>
          </div>
          {chartStakingGov.length > 0 && <StakingGovActivityLineChart data={chartStakingGov} timeAxis={timeAxis} />}
        </>
      }
    >
      <TxActivityLineChart data={chartTx} anomalies={flagged} bucketsAreDays={granularity === "day"} timeAxis={timeAxis} />
      <div className="grid gap-4 sm:grid-cols-3">
        <SupportFigure
          label="Distinct accounts per day"
          value={fmtNum(q?.support.distinctAccountsPerDayAvg.current ?? null, 1)}
          previous={fmtNum(q?.support.distinctAccountsPerDayAvg.previous ?? null, 1)}
          delta={fmtPct(q?.support.distinctAccountsPerDayAvg.pctChange ?? null)}
          deltaValue={q?.support.distinctAccountsPerDayAvg.pctChange ?? null}
          definition={DEFINITIONS.q1_distinct_accounts_per_day}
        />
        <SupportFigure
          label="Failure rate"
          value={q?.support.failureRatePct.current === null || q?.support.failureRatePct.current === undefined ? "—" : `${q.support.failureRatePct.current.toFixed(2)}%`}
          previous={q?.support.failureRatePct.previous === null || q?.support.failureRatePct.previous === undefined ? "—" : `${q.support.failureRatePct.previous.toFixed(2)}%`}
          definition={DEFINITIONS.q1_failure_rate}
          upIsGood={false}
        />
        <SupportFigure
          label="Paid fees"
          value={q?.support.feePaidBld.current === null || q?.support.feePaidBld.current === undefined ? bld(k.feePaidUbld.current) : `${fmtNum(q.support.feePaidBld.current, 2)} BLD`}
          previous={q?.support.feePaidBld.previous === null || q?.support.feePaidBld.previous === undefined ? bld(k.feePaidUbld.previous) : `${fmtNum(q.support.feePaidBld.previous, 2)} BLD`}
          delta={fmtPct(q?.support.feePaidBld.pctChange ?? k.feePaidUbld.pctChange)}
          deltaValue={q?.support.feePaidBld.pctChange ?? k.feePaidUbld.pctChange}
          definition={DEFINITIONS.q1_paid_fees}
        />
      </div>
    </QuestionBlock>
  );
}
