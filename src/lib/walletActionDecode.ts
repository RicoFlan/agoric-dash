/**
 * Decode a MsgWalletSpendAction / MsgWalletAction into its owner (bech32) and the marshalled action
 * string, then to a {@link WalletActionSummary}. Shared by the indexer and the offer-category
 * backfill so both derive identical categories from identical inputs. Returns null when the body
 * cannot be decoded (the caller decides whether to count it as an unknown action).
 */
import type { EncodeObject } from "@cosmjs/proto-signing";
import { toBech32 } from "@cosmjs/encoding";
import { decodeMsg } from "@/lib/cosmos";
import { instanceName } from "@/lib/agoricInstanceNames";
import { classifyOfferCategory, type OfferCategory } from "@/lib/offerCategory";
import { parseWalletActionString } from "@/lib/walletOfferMarshal";
import { summarizeWalletAction } from "@/lib/walletOfferSummary";
import type { WalletActionSummary } from "@/lib/walletOfferTypes";

export interface DecodedWalletAction {
  /** Submitting smart-wallet owner (bech32), or "" when absent. */
  owner: string;
  summary: WalletActionSummary;
  /** agoricNames label for the target instance, when resolvable. */
  instanceName: string | null;
  /** Exactly one functional category (same rule as the `offer_category` rollup). */
  category: OfferCategory;
}

export function decodeWalletAction(enc: EncodeObject): DecodedWalletAction | null {
  let owner = "";
  let actionStr = "";
  try {
    const body = decodeMsg(enc) as { owner?: Uint8Array; spendAction?: string; action?: string };
    if (body.owner && body.owner.length > 0) owner = toBech32("agoric", body.owner);
    actionStr = body.spendAction ?? body.action ?? "";
  } catch {
    return null;
  }
  const summary = summarizeWalletAction(parseWalletActionString(actionStr));
  const resolved = instanceName(summary.instanceBoardId);
  return { owner, summary, instanceName: resolved, category: offerCategoryOf(summary, resolved) };
}

/** The one category the `offer_category` rollup assigns to an action (kept in step with walletOfferRollup). */
export function offerCategoryOf(summary: WalletActionSummary, resolvedInstanceName: string | null): OfferCategory {
  return classifyOfferCategory({
    kind: summary.kind,
    source: summary.source,
    instanceName: resolvedInstanceName,
    maker: summary.maker,
    targetName: summary.targetName,
  });
}
