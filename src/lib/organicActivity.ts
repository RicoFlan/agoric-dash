/**
 * Q2 — "Is usage becoming more organic?" Pure derivation from the `offer_category` rollup: each
 * wallet action carries exactly one category, and `categoryAutomation()` groups categories into
 * interactive (vaults, PSM, auction, governance) vs automated (orchestration, oracle, fast-USDC)
 * vs unknown (`other`). The organic activity ratio is interactive ÷ ALL actions, so bot-dominated
 * days read low even when interactive counts are steady. Reported with the raw counts because a
 * falling ratio on a rising base and a falling ratio on a collapsing base mean different things.
 */
import { categoryAutomation, type OfferCategory } from "@/lib/offerCategory";
import { SERIES } from "@/lib/semantics";
import type { DayValue } from "@/lib/anomalies";

/** day → series → dimension → value, day-grain (see `questionsInputs.dailyContext`). */
export type DayBucketMap = Map<string, Map<string, Map<string, bigint>>>;

export interface OrganicCounts {
  interactive: number;
  automated: number;
  other: number;
  total: number;
  /** Interactive actions per category, largest first. Lets a reader see when one product is the whole story. */
  interactiveByCategory: { category: string; count: number }[];
}

export interface OrganicActivity {
  /** Interactive ÷ total, as a percentage; null when there were no actions. */
  ratioPct: { current: number | null; previous: number | null; deltaPts: number | null };
  counts: { current: OrganicCounts; previous: OrganicCounts };
  /** Per-day ratio over the context window (null on days with no actions); input for anomalies and the chart. */
  dailyRatioPct: DayValue[];
  /** Per-day counts over the context window. */
  dailyCounts: { day: string; counts: OrganicCounts }[];
}

function emptyCounts(): OrganicCounts {
  return { interactive: 0, automated: 0, other: 0, total: 0, interactiveByCategory: [] };
}

function countsForDay(sm: Map<string, Map<string, bigint>> | undefined): OrganicCounts {
  const c = emptyCounts();
  const dm = sm?.get(SERIES.OFFER_CATEGORY);
  if (!dm) return c;
  for (const [cat, v] of dm) {
    const n = Number(v);
    const cls = categoryAutomation(cat as OfferCategory);
    if (cls === "interactive") {
      c.interactive += n;
      c.interactiveByCategory.push({ category: cat, count: n });
    } else if (cls === "automated") c.automated += n;
    else c.other += n;
    c.total += n;
  }
  c.interactiveByCategory.sort((a, b) => b.count - a.count);
  return c;
}

function add(a: OrganicCounts, b: OrganicCounts): OrganicCounts {
  const merged = new Map<string, number>();
  for (const r of [...a.interactiveByCategory, ...b.interactiveByCategory]) {
    merged.set(r.category, (merged.get(r.category) ?? 0) + r.count);
  }
  return {
    interactive: a.interactive + b.interactive,
    automated: a.automated + b.automated,
    other: a.other + b.other,
    total: a.total + b.total,
    interactiveByCategory: [...merged.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((x, y) => y.count - x.count),
  };
}

export function organicRatioPct(c: OrganicCounts): number | null {
  return c.total > 0 ? (c.interactive / c.total) * 100 : null;
}

/**
 * @param dailyContext day-grain buckets covering at least [prevFromDay, toDay]
 * @param days  UTC days of the selected range, ascending
 * @param prevDays UTC days of the prior window, ascending
 * @param contextDays every day to emit in the daily series (superset of `days`), ascending
 */
export function buildOrganicActivity(
  dailyContext: DayBucketMap,
  days: readonly string[],
  prevDays: readonly string[],
  contextDays: readonly string[]
): OrganicActivity {
  const perDay = new Map<string, OrganicCounts>();
  for (const d of contextDays) perDay.set(d, countsForDay(dailyContext.get(d)));
  const sum = (ds: readonly string[]) =>
    ds.reduce((acc, d) => add(acc, perDay.get(d) ?? countsForDay(dailyContext.get(d))), emptyCounts());
  const current = sum(days);
  const previous = sum(prevDays);
  const cur = organicRatioPct(current);
  const prev = organicRatioPct(previous);
  return {
    ratioPct: { current: cur, previous: prev, deltaPts: cur !== null && prev !== null ? cur - prev : null },
    counts: { current, previous },
    dailyRatioPct: contextDays.map((day) => ({ day, value: organicRatioPct(perDay.get(day)!) })),
    dailyCounts: contextDays.map((day) => ({ day, counts: perDay.get(day)! })),
  };
}
