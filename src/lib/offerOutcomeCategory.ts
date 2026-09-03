/**
 * Settled-offer outcomes BY functional category (`offer_outcome_category`). The dimension packs
 * `category|outcome` so one series answers "how satisfied are vault offers vs PSM offers?" without a
 * second table. Category comes from the `invitationSpec` the smart wallet echoes back in the terminal
 * vstorage `offerStatus` (OfferStatus = OfferSpec & updates), classified with the same rule as the
 * `offer_category` intent rollup. When a status carries no spec, the category is
 * `unclassified` — visible in the data rather than silently folded into `other`.
 */
import { OFFER_CATEGORIES, type OfferCategory } from "@/lib/offerCategory";
import type { OfferOutcome } from "@/lib/walletOutcomeSummary";

export const OUTCOME_CATEGORY_UNCLASSIFIED = "unclassified" as const;
export type OutcomeCategory = OfferCategory | typeof OUTCOME_CATEGORY_UNCLASSIFIED;
export const OUTCOME_CATEGORIES: readonly OutcomeCategory[] = [...OFFER_CATEGORIES, OUTCOME_CATEGORY_UNCLASSIFIED];

const OUTCOMES: readonly OfferOutcome[] = ["wants_satisfied", "wants_unsatisfied", "errored"];
const SEP = "|";

export function outcomeCategoryDim(category: OutcomeCategory, outcome: OfferOutcome): string {
  return `${category}${SEP}${outcome}`;
}

export function parseOutcomeCategoryDim(dim: string): { category: OutcomeCategory; outcome: OfferOutcome } | null {
  const i = dim.indexOf(SEP);
  if (i < 0) return null;
  const category = dim.slice(0, i) as OutcomeCategory;
  const outcome = dim.slice(i + 1) as OfferOutcome;
  if (!OUTCOME_CATEGORIES.includes(category) || !OUTCOMES.includes(outcome)) return null;
  return { category, outcome };
}

export interface OutcomeByCategory {
  category: OutcomeCategory;
  settled: number;
  wantsSatisfied: number;
  wantsUnsatisfied: number;
  errored: number;
  /** wantsSatisfied ÷ settled × 100; null when nothing settled. */
  satisfactionRatePct: number | null;
}

/** Fold `offer_outcome_category` dimension totals into per-category rows (categories with no settles omitted), largest first. */
export function outcomesByCategory(dimTotals: ReadonlyMap<string, bigint>): OutcomeByCategory[] {
  const acc = new Map<OutcomeCategory, OutcomeByCategory>();
  for (const [dim, v] of dimTotals) {
    const p = parseOutcomeCategoryDim(dim);
    if (!p) continue;
    const n = Number(v);
    const row = acc.get(p.category) ?? {
      category: p.category,
      settled: 0,
      wantsSatisfied: 0,
      wantsUnsatisfied: 0,
      errored: 0,
      satisfactionRatePct: null,
    };
    row.settled += n;
    if (p.outcome === "wants_satisfied") row.wantsSatisfied += n;
    else if (p.outcome === "wants_unsatisfied") row.wantsUnsatisfied += n;
    else row.errored += n;
    acc.set(p.category, row);
  }
  return [...acc.values()]
    .filter((r) => r.settled > 0)
    .map((r) => ({ ...r, satisfactionRatePct: (r.wantsSatisfied / r.settled) * 100 }))
    .sort((a, b) => b.settled - a.settled);
}
