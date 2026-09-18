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
  /** YMax users: portfolio offers on ymax0/ymax1 and EVM-wallet deposits via evmWalletHandler (P6). */
  | "ymax"
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
  "ymax",
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
  if (/^ymax/i.test(name)) return "ymax";
  return "other";
}

/** invokeEntry targets that are a user acting through YMax's EVM-wallet handler, not a bot. */
const YMAX_USER_INVOKE_TARGETS = new Set(["evmWalletHandler"]);

/**
 * Invitation makers that identify their contract by name alone, for continuing offers that carry no
 * resolvable Instance. This is the ONLY handle those offers give us, so a name may be used here only
 * if it is unique to one contract in agoric-sdk — otherwise another contract's activity would be
 * filed under this one, silently and with nothing on the offer to contradict it.
 *
 * Audited against Agoric's source before adding:
 *  - `SettleTransaction`, `SubmitEvidence` — `packages/fast-usdc-contract`, the settlement and
 *    operator-kit paths. Operators submitting CCTP evidence are automation, not users.
 *  - `SimpleRebalance` — `packages/portfolio-contract/src/portfolio.exo.ts`, of which ymax0/ymax1 are
 *    the instances. It is a PortfolioContinuingInvitationMaker, handed to the portfolio holder at
 *    creation, so it is a user managing their own position. The planner cannot be its submitter:
 *    the planner acts through invokeEntry, recorded as `invoke_target`, and `offer_maker` is only
 *    written for `zoe_offer` (walletOfferRollup.ts) — the two paths are mutually exclusive.
 *
 * DELIBERATELY ABSENT: `Rebalance`, the fourth name in `PortfolioContinuingInvitationMaker`. It is
 * portfolio-contract's legacy rebalance path, superseded by `SimpleRebalance` and with zero actions
 * in indexed history, so adding it buys nothing measurable — while `Rebalance` is an ordinary word
 * that a contract outside agoric-sdk (Crabble, KREAd, anything deployed later) could plausibly use
 * as a maker name. Uniqueness is checkable inside agoric-sdk and NOT across every contract on
 * mainnet, so the bar is a distinctive coinage: `SimpleRebalance` and `SubmitEvidence` clear it and
 * `Rebalance` does not.
 *
 * DELIBERATELY ABSENT: `Deposit` and `Withdraw`, the sibling makers on that same portfolio facet.
 * `packages/orchestration/src/exos/local-orchestration-account.js` declares an `invitationMakers`
 * interface carrying `CloseAccount, Delegate, Deposit, Send, SendAll, Transfer, Undelegate,
 * Withdraw`, so any contract handing out a LocalOrchestrationAccount's makers — Fast-USDC among them
 * on this chain — produces offers with those names. They stay `other` until a continuing offer can be
 * resolved by the seat it acts on (`invitationSpec.previousOffer`) rather than by a name, which is
 * decoded today but discarded in walletOfferSummary.ts.
 */
const MAKER_CATEGORY: ReadonlyMap<string, OfferCategory> = new Map([
  ["SettleTransaction", "fast_usdc"],
  ["SubmitEvidence", "fast_usdc"],
  ["SimpleRebalance", "ymax"],
] as const);

/** Exactly one functional category per wallet action (objective; baked into offer_category). */
export function classifyOfferCategory(input: OfferCategoryInput): OfferCategory {
  // invokeEntry: automation by construction (planner, delegates…) — except YMax's EVM-wallet
  // handler, which is how a user with an EVM wallet deposits into a portfolio.
  if (input.kind === "wallet_invocation") {
    return input.targetName && YMAX_USER_INVOKE_TARGETS.has(input.targetName) ? "ymax" : "orchestration";
  }

  if (input.instanceName) return categoryFromInstanceName(input.instanceName);

  // No resolvable instance (continuing / tryExitOffer): fall back to the invitation maker.
  const maker = input.maker ?? "";
  if (/pushprice/i.test(maker)) return "oracle";
  // A Map, not an object literal: `maker` is chain-controlled (invitationMakerName off the decoded
  // offer), and an object lookup for `constructor`, `toString`, `valueOf`, `hasOwnProperty` or
  // `__proto__` returns an inherited member — truthy — which would be written out as the category.
  return MAKER_CATEGORY.get(maker) ?? "other";
}

/**
 * Coarse automated-vs-interactive grouping (read-time, refinable without reindex). Machine-driven
 * flows (fast-USDC settlement, orchestration, oracle pushes) vs deliberate economic/governance
 * offers. On agoric-3 the interactive side is in practice `ymax` plus a little `psm`: `vaults`,
 * `auction` and `governance` stay declared here but record zero actions, because Inter Protocol was
 * wound down to a 30 June 2025 shutdown, before indexed history begins. `other` is left unknown
 * rather than guessed.
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
    case "ymax":
      return "interactive";
    default:
      return "unknown";
  }
}
