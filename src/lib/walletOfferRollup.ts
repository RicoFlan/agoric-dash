/**
 * Pure mapping from a {@link WalletActionSummary} to `daily_metrics` / `hourly_metrics` count
 * deltas (+1 each). Keeps the indexer's wallet-action rollup logic testable in isolation and aligned
 * with the SERIES / metricDictionary entries.
 *
 * Every delta is a +1 count for the given (series, dimension). The indexer applies it to both daily
 * and hourly buckets. Dimensions are short structural strings (kind/source/board id/maker/target);
 * we defensively clamp to the `dimension` column width so an unexpectedly long value can never break
 * the insert.
 */
import { SERIES } from "@/lib/semantics";
import type { WalletActionSummary } from "@/lib/walletOfferTypes";
import { classifyOfferCategory } from "@/lib/offerCategory";

/** Matches `dimension varchar(512)` in daily_metrics / hourly_metrics. */
export const MAX_DIMENSION_LEN = 512;

export interface OfferRollupDelta {
  readonly series: string;
  readonly dimension: string;
}

function clampDim(s: string): string {
  return s.length > MAX_DIMENSION_LEN ? s.slice(0, MAX_DIMENSION_LEN) : s;
}

/**
 * Objective count deltas for one decoded wallet action (already gated to successful txs upstream):
 *  - always: `wallet_actions` by kind; `offer_category` (exactly one functional category)
 *  - zoe_offer: `offer_source` by source; `offer_instance` by Board id (when present);
 *    `offer_maker` by maker (when present)
 *  - wallet_invocation: `invoke_target` by targetName (when present)
 *
 * `resolvedInstanceName` is the agoricNames label for `summary.instanceBoardId` (or null) — passed in
 * by the indexer so this helper stays pure/testable while still producing an accurate category.
 */
export function walletActionRollupDeltas(
  summary: WalletActionSummary,
  resolvedInstanceName: string | null = null
): OfferRollupDelta[] {
  const category = classifyOfferCategory({
    kind: summary.kind,
    source: summary.source,
    instanceName: resolvedInstanceName,
    maker: summary.maker,
    targetName: summary.targetName,
  });

  const out: OfferRollupDelta[] = [
    { series: SERIES.WALLET_ACTIONS, dimension: summary.kind },
    { series: SERIES.OFFER_CATEGORY, dimension: category },
  ];

  if (summary.kind === "zoe_offer") {
    out.push({ series: SERIES.OFFER_SOURCE, dimension: summary.source });
    if (summary.instanceBoardId) {
      out.push({ series: SERIES.OFFER_INSTANCE, dimension: clampDim(summary.instanceBoardId) });
    }
    if (summary.maker) {
      out.push({ series: SERIES.OFFER_MAKER, dimension: clampDim(summary.maker) });
    }
  } else if (summary.kind === "wallet_invocation") {
    if (summary.targetName) {
      out.push({ series: SERIES.INVOKE_TARGET, dimension: clampDim(summary.targetName) });
    }
  }

  return out;
}
