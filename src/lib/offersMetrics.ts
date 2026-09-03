/**
 * Pure assembly of the SwingSet/Zoe "offers" payload section from rollup bucket maps
 * (bucket → series → dimension → value). No DB / I/O — distinct-wallet counts are joined in
 * separately (offersQuery.ts) since they come from `offer_participant_day`.
 *
 * Reads the offer series produced by the indexer (semantics.ts SERIES + walletOfferRollup.ts):
 * wallet_actions (by kind), offer_category (one per action), offer_source, offer_instance,
 * offer_maker, invoke_target. Instance Board ids are resolved to agoricNames labels at read time;
 * the automated-vs-interactive grouping is the read-time relabel of offer_category.
 */
import { SERIES } from "@/lib/semantics";
import { instanceName } from "@/lib/agoricInstanceNames";
import {
  categoryAutomation,
  OFFER_CATEGORIES,
  type AutomationClass,
  type OfferCategory,
} from "@/lib/offerCategory";
import { outcomesByCategory, type OutcomeByCategory } from "@/lib/offerOutcomeCategory";

export type OfferBuckets = Map<string, Map<string, Map<string, bigint>>>;

export interface KpiDelta {
  current: string;
  previous: string;
  pctChange: number | null;
}

export interface CategoryCount {
  category: OfferCategory;
  automation: AutomationClass;
  count: string;
}

export interface LabeledCount {
  key: string;
  label: string;
  count: string;
}

export interface OfferBucketPoint {
  bucket: string;
  value: string;
}

export type OfferOutcomeDim = "wants_satisfied" | "wants_unsatisfied" | "errored";

export interface OffersSection {
  kpis: {
    totalActions: KpiDelta;
    zoeOffers: KpiDelta;
    walletInvocations: KpiDelta;
    automatedActions: KpiDelta;
    interactiveActions: KpiDelta;
  };
  /** Settled Zoe offer outcomes (block-grain, self-indexed from vstorage offerStatus). */
  outcomes: {
    settled: KpiDelta;
    wantsSatisfied: KpiDelta;
    wantsUnsatisfied: KpiDelta;
    errored: KpiDelta;
    /** Share (0–100) of settled offers with wants satisfied, or null when nothing settled in range. */
    satisfactionRatePct: number | null;
    /** Per-bucket settled-offer counts by outcome (dense over cur buckets), for the trend. */
    overTime: { outcome: OfferOutcomeDim; data: OfferBucketPoint[] }[];
    /** Settled offers split by functional category (offer_outcome_category), largest first; empty before the P2 backfill. */
    byCategory: OutcomeByCategory[];
  };
  byCategory: CategoryCount[];
  bySource: LabeledCount[];
  byInstance: LabeledCount[];
  byMaker: LabeledCount[];
  byTarget: LabeledCount[];
  /** Per-bucket counts by functional category (dense over the cur buckets), for the stacked trend. */
  categoriesOverTime: { category: OfferCategory; data: OfferBucketPoint[] }[];
  /** Per-bucket total wallet actions, for the trend axis / totals overlay. */
  totalOverTime: OfferBucketPoint[];
  /**
   * Offer economic value by vbank denom (atomic integer strings), for read-time USD valuation.
   * give/want are offer intent (escrowed/requested); payouts are what settled. Non-vbank brands omitted.
   */
  value: {
    giveByDenom: Record<string, string>;
    wantByDenom: Record<string, string>;
    payoutByDenom: Record<string, string>;
  };
}

function denomRecord(dims: Map<string, bigint>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [denom, v] of dims) if (v > BigInt(0)) out[denom] = v.toString();
  return out;
}

function dimTotals(b: OfferBuckets, series: string): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const sm of b.values()) {
    const dm = sm.get(series);
    if (!dm) continue;
    for (const [dim, v] of dm) out.set(dim, (out.get(dim) ?? BigInt(0)) + v);
  }
  return out;
}

function sumMap(m: Map<string, bigint>): bigint {
  let t = BigInt(0);
  for (const v of m.values()) t += v;
  return t;
}

function dimValue(m: Map<string, bigint>, dim: string): bigint {
  return m.get(dim) ?? BigInt(0);
}

function pctChange(current: bigint, previous: bigint): number | null {
  if (previous === BigInt(0)) return current === BigInt(0) ? 0 : null;
  return Number(((current - previous) * BigInt(10000)) / previous) / 100;
}

function kpi(current: bigint, previous: bigint): KpiDelta {
  return { current: current.toString(), previous: previous.toString(), pctChange: pctChange(current, previous) };
}

/** Sum of offer_category dims whose automation grouping matches `cls`. */
function automationTotal(categoryDims: Map<string, bigint>, cls: AutomationClass): bigint {
  let t = BigInt(0);
  for (const [cat, v] of categoryDims) {
    if (categoryAutomation(cat as OfferCategory) === cls) t += v;
  }
  return t;
}

function sortedLabeled(
  dims: Map<string, bigint>,
  label: (key: string) => string
): LabeledCount[] {
  return [...dims.entries()]
    .filter(([, v]) => v > BigInt(0))
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .map(([key, v]) => ({ key, label: label(key), count: v.toString() }));
}

function categoryOverTime(b: OfferBuckets, category: OfferCategory): OfferBucketPoint[] {
  return [...b.keys()].sort().map((bucket) => ({
    bucket,
    value: (b.get(bucket)?.get(SERIES.OFFER_CATEGORY)?.get(category) ?? BigInt(0)).toString(),
  }));
}

function totalActionsOverTime(b: OfferBuckets): OfferBucketPoint[] {
  return [...b.keys()].sort().map((bucket) => {
    const km = b.get(bucket)?.get(SERIES.WALLET_ACTIONS);
    let t = BigInt(0);
    if (km) for (const v of km.values()) t += v;
    return { bucket, value: t.toString() };
  });
}

export function buildOffersSection(cur: OfferBuckets, prev: OfferBuckets): OffersSection {
  const curKinds = dimTotals(cur, SERIES.WALLET_ACTIONS);
  const prevKinds = dimTotals(prev, SERIES.WALLET_ACTIONS);
  const curCats = dimTotals(cur, SERIES.OFFER_CATEGORY);
  const prevCats = dimTotals(prev, SERIES.OFFER_CATEGORY);

  const byCategory: CategoryCount[] = OFFER_CATEGORIES.map((category) => ({
    category,
    automation: categoryAutomation(category),
    count: dimValue(curCats, category).toString(),
  })).filter((c) => c.count !== "0");
  byCategory.sort((a, b) => (BigInt(b.count) > BigInt(a.count) ? 1 : BigInt(b.count) < BigInt(a.count) ? -1 : 0));

  const presentCategories = OFFER_CATEGORIES.filter((c) => dimValue(curCats, c) > BigInt(0));

  const curOutcomes = dimTotals(cur, SERIES.OFFER_OUTCOME);
  const prevOutcomes = dimTotals(prev, SERIES.OFFER_OUTCOME);
  const settled = sumMap(curOutcomes);
  const satisfied = dimValue(curOutcomes, "wants_satisfied");
  const presentOutcomes: OfferOutcomeDim[] = (["wants_satisfied", "wants_unsatisfied", "errored"] as const).filter(
    (o) => dimValue(curOutcomes, o) > BigInt(0)
  );

  return {
    kpis: {
      totalActions: kpi(sumMap(curKinds), sumMap(prevKinds)),
      zoeOffers: kpi(dimValue(curKinds, "zoe_offer"), dimValue(prevKinds, "zoe_offer")),
      walletInvocations: kpi(dimValue(curKinds, "wallet_invocation"), dimValue(prevKinds, "wallet_invocation")),
      automatedActions: kpi(automationTotal(curCats, "automated"), automationTotal(prevCats, "automated")),
      interactiveActions: kpi(automationTotal(curCats, "interactive"), automationTotal(prevCats, "interactive")),
    },
    outcomes: {
      settled: kpi(settled, sumMap(prevOutcomes)),
      wantsSatisfied: kpi(satisfied, dimValue(prevOutcomes, "wants_satisfied")),
      wantsUnsatisfied: kpi(dimValue(curOutcomes, "wants_unsatisfied"), dimValue(prevOutcomes, "wants_unsatisfied")),
      errored: kpi(dimValue(curOutcomes, "errored"), dimValue(prevOutcomes, "errored")),
      satisfactionRatePct:
        settled === BigInt(0) ? null : Number((satisfied * BigInt(10000)) / settled) / 100,
      overTime: presentOutcomes.map((outcome) => ({
        outcome,
        data: [...cur.keys()].sort().map((bucket) => ({
          bucket,
          value: (cur.get(bucket)?.get(SERIES.OFFER_OUTCOME)?.get(outcome) ?? BigInt(0)).toString(),
        })),
      })),
      byCategory: outcomesByCategory(dimTotals(cur, SERIES.OFFER_OUTCOME_CATEGORY)),
    },
    byCategory,
    bySource: sortedLabeled(dimTotals(cur, SERIES.OFFER_SOURCE), (k) => k),
    byInstance: sortedLabeled(dimTotals(cur, SERIES.OFFER_INSTANCE), (boardId) => instanceName(boardId) ?? boardId),
    byMaker: sortedLabeled(dimTotals(cur, SERIES.OFFER_MAKER), (k) => k),
    byTarget: sortedLabeled(dimTotals(cur, SERIES.INVOKE_TARGET), (k) => k),
    categoriesOverTime: presentCategories.map((category) => ({ category, data: categoryOverTime(cur, category) })),
    totalOverTime: totalActionsOverTime(cur),
    value: {
      giveByDenom: denomRecord(dimTotals(cur, SERIES.OFFER_GIVE_VOLUME)),
      wantByDenom: denomRecord(dimTotals(cur, SERIES.OFFER_WANT_VOLUME)),
      payoutByDenom: denomRecord(dimTotals(cur, SERIES.OFFER_PAYOUT_VOLUME)),
    },
  };
}
