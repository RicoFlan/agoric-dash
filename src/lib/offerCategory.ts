/**
 * Functional categorization of smart-wallet actions, for defensible offer segmentation.
 *
 * Two layers:
 *  - {@link classifyOfferCategory}: assigns exactly ONE objective category per action from
 *    structural facts (kind, invitation source, resolved target Instance name, maker, invocation
 *    target). Baked into the indexer's `offer_category` series so counts are additive/non-overlapping
 *    (covers instance-less continuing offers via maker).
 *  - {@link categoryAutomation}: groups categories into a coarse automated-vs-interactive view. This
 *    is a read-time relabel (no reindex needed to refine), kept separate because "is this a bot?" is
 *    a heuristic while the category itself is grounded in which contract was used.
 *
 * Categories observed on agoric-3 (Phase 0b): price feeds + scaledPriceAuthority (oracle), the
 * econ/kread committees+governors+charters (governance), VaultFactory (vaults), psm-* (psm),
 * auctioneer/reserve (auction), fastUsdc settlement (fast_usdc), ymax + invokeEntry handlers like
 * planner/evmWalletHandler (orchestration). Everything else is `other`.
 */
import type { OfferSource, WalletActionKind } from "@/lib/walletOfferTypes";

export type OfferCategory =
  | "oracle"
  | "governance"
  | "vaults"
  | "psm"
  | "auction"
  | "fast_usdc"
  | "orchestration"
  | "other";

export type AutomationClass = "automated" | "interactive" | "unknown";

export const OFFER_CATEGORIES: readonly OfferCategory[] = [
  "oracle",
  "governance",
  "vaults",
  "psm",
  "auction",
  "fast_usdc",
  "orchestration",
  "other",
];

export interface OfferCategoryInput {
  readonly kind: WalletActionKind;
  readonly source: OfferSource;
  readonly instanceName: string | null;
  readonly maker: string | null;
  readonly targetName: string | null;
}

function categoryFromInstanceName(name: string): OfferCategory {
  if (/price feed$/i.test(name) || /^scaledPriceAuthority/i.test(name)) return "oracle";
  if (/(Committee|Governor|Charter)$/.test(name) || name === "economicCommittee") return "governance";
  if (name === "VaultFactory") return "vaults";
  if (/^psm-/i.test(name)) return "psm";
  if (name === "auctioneer" || name === "reserve") return "auction";
  if (name === "fastUsdc") return "fast_usdc";
  if (/^ymax/i.test(name)) return "orchestration";
  return "other";
}

/** Exactly one functional category per wallet action (objective; baked into offer_category). */
export function classifyOfferCategory(input: OfferCategoryInput): OfferCategory {
  // invokeEntry: direct entry invocations are orchestration/automation by construction.
  if (input.kind === "wallet_invocation") return "orchestration";

  if (input.instanceName) return categoryFromInstanceName(input.instanceName);

  // No resolvable instance (continuing / tryExitOffer): fall back to the invitation maker.
  const maker = input.maker ?? "";
  if (/pushprice/i.test(maker)) return "oracle";
  if (maker === "SettleTransaction") return "fast_usdc";
  return "other";
}

/**
 * Coarse automated-vs-interactive grouping (read-time, refinable without reindex). Machine-driven
 * flows (orchestration, oracle pushes, fast-USDC settlement) vs deliberate economic/governance
 * offers (vaults, psm, auction, governance). `other` is left unknown rather than guessed.
 */
export function categoryAutomation(category: OfferCategory): AutomationClass {
  switch (category) {
    case "orchestration":
    case "oracle":
    case "fast_usdc":
      return "automated";
    case "vaults":
    case "psm":
    case "auction":
    case "governance":
      return "interactive";
    default:
      return "unknown";
  }
}
