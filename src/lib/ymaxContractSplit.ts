/**
 * Splits YMax's deployed-principal venues by contract, for disclosure beside the Q3 headline.
 *
 * `ymax0` and `ymax1` are two CONCURRENT deployments, not a redeploy boundary: both publish under
 * their own vstorage root, both were updated at chain head, and both portfolio id namespaces start
 * at `portfolio0`, so `portfolio101` exists in each and means something different. They are keyed
 * separately in storage, so nothing collides — but Q3 sums them into one figure.
 *
 * Summing is the right answer to the question Q3 asks: how much capital is deployed through
 * orchestration. Dropping a venue for being small would invert the project's own principle — it is
 * real deployed capital. What the sum cannot do is show that one deployment holds essentially all of
 * it, so a reader has no way to notice when the small one stops being small. This split is that
 * disclosure, and it changes no headline.
 */
export interface YmaxVenueLike {
  readonly contract: string;
  readonly positions: number;
  readonly principalUsd: number | null;
  /** Native principal as an integer string; used only to drop venues holding nothing. */
  readonly principal?: string;
}

/** A venue that holds nothing: principal "0" natively, or 0 USD with no native figure to check. */
function isZeroPrincipal(v: YmaxVenueLike): boolean {
  if (typeof v.principal === "string" && /^-?\d+$/.test(v.principal)) {
    return BigInt(v.principal) === BigInt(0);
  }
  return v.principalUsd === 0;
}

export interface YmaxContractTotal {
  readonly contract: string;
  readonly positions: number;
  /** Σ over this contract's PRICED venues; null when it has none. */
  readonly principalUsd: number | null;
  /** Share of the priced total across all contracts; null when that total is zero or unavailable. */
  readonly sharePct: number | null;
  /** Venues in this contract with no USD price — excluded from `principalUsd`, disclosed here. */
  readonly unpricedVenues: number;
}

/**
 * Per-contract totals, largest priced principal first. Positions are summed because a position
 * belongs to exactly one venue; PORTFOLIO counts are deliberately not summed, since a portfolio can
 * hold positions in several venues and adding them would over-count it.
 */
export function ymaxContractSplit(byVenue: readonly YmaxVenueLike[]): YmaxContractTotal[] {
  const acc = new Map<string, { positions: number; usd: number | null; unpriced: number }>();
  for (const v of byVenue) {
    // Venues holding nothing are excluded, matching the venue table beside this split: ymaxQueries
    // admits total_in = total_out, so a drained venue survives with principal 0. Counting its
    // positions here while the table omits them makes the two disagree on the same page — which
    // happens today, for ymax0's Beefy/Optimism venue.
    if (isZeroPrincipal(v)) continue;
    const cur = acc.get(v.contract) ?? { positions: 0, usd: null, unpriced: 0 };
    cur.positions += v.positions;
    if (v.principalUsd === null) cur.unpriced += 1;
    else cur.usd = (cur.usd ?? 0) + v.principalUsd;
    acc.set(v.contract, cur);
  }
  const pricedTotal = [...acc.values()].reduce((s, c) => s + (c.usd ?? 0), 0);
  return [...acc.entries()]
    .map(([contract, c]) => ({
      contract,
      positions: c.positions,
      principalUsd: c.usd,
      sharePct: c.usd !== null && pricedTotal > 0 ? (c.usd / pricedTotal) * 100 : null,
      unpricedVenues: c.unpriced,
    }))
    .sort((a, b) => (b.principalUsd ?? -Infinity) - (a.principalUsd ?? -Infinity));
}

/**
 * One contract's share, formatted so the split never contradicts itself.
 *
 * Plain rounding breaks at both ends: the production figures are 99.9977% and 0.0023%, which print
 * as "100.0%" and "<0.1%" — a pair that reads as "this is everything" beside "this exists", and
 * whose parts appear to exceed the whole. A share that is not actually 100 is never shown as 100,
 * and a share that is not actually 0 is never shown as 0.
 */
export function formatSharePct(sharePct: number | null): string | null {
  if (sharePct === null || !Number.isFinite(sharePct)) return null;
  if (sharePct >= 100) return "100%";
  if (sharePct >= 99.95) return ">99.9%";
  if (sharePct <= 0) return "0%";
  if (sharePct < 0.1) return "<0.1%";
  return `${sharePct.toFixed(1)}%`;
}
