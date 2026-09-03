/**
 * Client-side shape of `/api/metrics` as the dashboard consumes it (string-encoded bigints, formatted
 * USD cells). Kept in one place so the question-block components and the shell agree; the server's
 * source of truth is `buildMetricsPayload` + the route's enrichment.
 */
import type { ConcentrationTimePoint } from "@/lib/concentrationTimeseries";
import type { UsdPricingMeta } from "@/lib/denomPrices";
import type { EnrichedDisplay } from "@/lib/metricsDisplayTypes";
import type { QuestionsPayload } from "@/lib/questionsPayload";

export type Granularity = "hour" | "day" | "week";

export type KpiDelta = { current: string; previous: string; pctChange: number | null };
export type OfferLabeledCount = { key: string; label: string; count: string };

export interface MetricsPayload {
  /** Four-questions section (P1/P2); absent on older API builds. */
  questions?: QuestionsPayload;
  granularity?: Granularity;
  display?: EnrichedDisplay;
  range: { from: string; to: string };
  comparisonWindow: { from: string; to: string };
  kpis: {
    txSuccess: { current: string; previous: string; pctChange: number | null };
    txFailed: { current: string; previous: string; pctChange: number | null };
    /** Success rate % (0–100), or null when no aligned txs in the window. */
    successRatePct: { current: number | null; previous: number | null };
    gasUsed: { current: string; previous: string; pctChange: number | null };
    gasWanted: { current: string; previous: string; pctChange: number | null };
    /** Gas efficiency % = gas_used / gas_wanted, or null when no gas requested. */
    gasEfficiencyPct: { current: number | null; previous: number | null };
    blockGasLimit: { current: string; previous: string; pctChange: number | null };
    /** Block-space utilization % = gas_used / block_gas_limit, or null when no limit recorded. */
    blockGasUtilizationPct: { current: number | null; previous: number | null };
    /** MsgTransfer message totals (`ibc_transfer_out_count`). */
    ibcOutboundMsgCount: {
      current: string;
      previous: string;
      pctChange: number | null;
    };
    /** Inbound recv-flow headline totals (ibc_transfer_flow_in display rollup). */
    ibcInboundRecvFlowCount: {
      current: string;
      previous: string;
      pctChange: number | null;
    };
    feesPaidAllDenoms: {
      current: string;
      previous: string;
      pctChange: number | null;
    };
    feePaidUbld: { current: string; previous: string; pctChange: number | null };
    stakingDelegations: { current: string; previous: string; pctChange: number | null };
    stakingUndelegations: { current: string; previous: string; pctChange: number | null };
    stakingRedelegations: { current: string; previous: string; pctChange: number | null };
    govVotes: { current: string; previous: string; pctChange: number | null };
    govProposals: { current: string; previous: string; pctChange: number | null };
  };
  series: {
    txTotal: { bucket: string; value: string }[];
    txFailed: { bucket: string; value: string }[];
    ibcCombinedCounts: { bucket: string; value: string }[];
    ibcOutboundMsgs: { bucket: string; value: string }[];
    ibcInboundRecvFlows: { bucket: string; value: string }[];
    gasUsed: { bucket: string; value: string }[];
    gasWanted: { bucket: string; value: string }[];
    blockGasLimit: { bucket: string; value: string }[];
    stakingGov: {
      delegations: { bucket: string; value: string }[];
      undelegations: { bucket: string; value: string }[];
      redelegations: { bucket: string; value: string }[];
      govVotes: { bucket: string; value: string }[];
      govProposals: { bucket: string; value: string }[];
    };
    transferVolumeSeries: { denom: string; data: { bucket: string; value: string }[] }[];
    bankCreditsVolumeSeries: { denom: string; data: { bucket: string; value: string }[] }[];
    ibcAmountInSeries: { denom: string; data: { bucket: string; value: string }[] }[];
    ibcAmountOutSeries: { denom: string; data: { bucket: string; value: string }[] }[];
  };
  transferVolumeByDenom: Record<string, string>;
  bankCreditsVolumeByDenom: Record<string, string>;
  transferVolumeUsdByDenom: Record<string, string | null>;
  bankCreditsVolumeUsdByDenom: Record<string, string | null>;
  transferVolumeUsdTotal: string | null;
  bankCreditsVolumeUsdTotal: string | null;
  usdPricingMeta: UsdPricingMeta;
  feePaidByDenom: Record<string, string>;
  feePaidByDenomPrevious: Record<string, string>;
  indexer: { lastIndexedHeight: string | null; updatedAt: string | null };
  participation?: {
    distinctSigners: string;
    distinctFeePayers: string;
    singleDayInRange: string;
    multiDayInRange: string;
    distinctUnionPerDay: { day: string; count: string }[];
  };
  concentration?: {
    top10AddressShareGrossUsd: string | null;
    top10AddressShareFeesUsd: string | null;
    grossUsdHhi: string | null;
    feesUsdHhi: string | null;
    usdPricingMeta?: UsdPricingMeta;
  };
  /** Distinct sending addresses per denom (range); wash-resistance context for the Value Flow Map. */
  distinctSendersByDenom?: Record<string, number>;
  /** Daily concentration trend (HHI + top-10 share) for gross-movement USD and paid-fee USD. */
  concentrationOverTime?: ConcentrationTimePoint[];
  /** Denominator-aware ratios (descriptive); "—" when a denominator is zero or USD is unpriced. */
  normalizedRatios?: {
    gasPerTx: string;
    feeBldPerSuccessfulTx: string;
    successfulTxsPerActiveAddress: string;
    grossUsdPerActiveAddress: string;
  };
  /** SwingSet/Zoe smart-wallet offer activity (intent surfacing) with distinct-wallet participation. */
  offers?: {
    kpis: {
      totalActions: KpiDelta;
      zoeOffers: KpiDelta;
      walletInvocations: KpiDelta;
      automatedActions: KpiDelta;
      interactiveActions: KpiDelta;
    };
    outcomes: {
      settled: KpiDelta;
      wantsSatisfied: KpiDelta;
      wantsUnsatisfied: KpiDelta;
      errored: KpiDelta;
      satisfactionRatePct: number | null;
      overTime: { outcome: string; data: { bucket: string; value: string }[] }[];
    };
    byCategory: { category: string; automation: string; count: string }[];
    bySource: OfferLabeledCount[];
    byInstance: OfferLabeledCount[];
    byMaker: OfferLabeledCount[];
    byTarget: OfferLabeledCount[];
    categoriesOverTime: { category: string; data: { bucket: string; value: string }[] }[];
    totalOverTime: { bucket: string; value: string }[];
    value: {
      giveByDenom: Record<string, string>;
      wantByDenom: Record<string, string>;
      payoutByDenom: Record<string, string>;
    };
    participants: {
      distinctWallets: number;
      distinctZoeOfferWallets: number;
      distinctInvocationWallets: number;
      perDay: { day: string; count: number }[];
    };
  };
  /** USD valuation of offer give/want/payout native amounts (day-priced; gross flow). */
  offerValueUsd?: {
    give: { byDenom: Record<string, string | null>; total: string | null };
    want: { byDenom: Record<string, string | null>; total: string | null };
    payouts: { byDenom: Record<string, string | null>; total: string | null };
    usdPricingMeta: UsdPricingMeta;
  } | null;
  /** First day included in indexed DB rollups (UTC); requests earlier than this are clamped. */
  indexedHistoryFromDay?: string;
  /** True when hour granularity was requested but `hourly_metrics` had no rows, so daily rollups were used for charts/KPIs. */
  usedDailyFallbackForHourView?: boolean;
}
