/**
 * Shared types for Agoric smart-wallet action surfacing (SwingSet/Zoe offer intent).
 *
 * Two layers, intentionally separated so the read path never imports @endo:
 *  - `walletOfferMarshal.ts` (indexer-only): unmarshals the on-chain CapData action string into a
 *    PLAIN structure where remotable references (Instances/Brands) become {@link BoardSlot} markers
 *    and bigints become decimal strings.
 *  - `walletOfferSummary.ts` (pure): turns that plain structure into a {@link WalletActionSummary}
 *    of objective, on-chain-grounded fields. No SES, no I/O — fully unit-testable.
 *
 * Design note (accuracy): the indexer stores only objective structural facts (action kind,
 * invitation source, target instance board id, invitation maker, give/want legs). The fuzzier
 * "user vs automated" judgement is derived later at read time, where board-id→contract-name
 * resolution lives and the mapping can be refined without re-indexing.
 */

/**
 * A decoded reference to an on-chain object (Zoe Instance, Issuer Brand, etc.). On-chain these are
 * remotables; in CapData they are slot references whose identity is a Board id (e.g. "board02568").
 * Distinct from a plain record so {@link summarizeWalletAction} can tell them apart unambiguously.
 */
export class BoardSlot {
  constructor(
    readonly boardId: string,
    readonly iface: string | null
  ) {}
}

/** Smart-wallet action method families. `invokeEntry` is a direct entry invocation, NOT a Zoe offer. */
export type WalletActionKind = "zoe_offer" | "wallet_invocation" | "unknown";

/** Zoe `invitationSpec.source` — how the invitation for an offer is obtained. */
export type OfferSource =
  | "contract"
  | "agoricContract"
  | "continuing"
  | "purse"
  | "unknown";

/** One give/want leg of a proposal: keyword → amount (brand board id + integer value as string). */
export interface OfferLeg {
  readonly keyword: string;
  readonly brandBoardId: string | null;
  readonly value: string | null;
}

/**
 * Objective summary of a single smart-wallet action, extracted from the decoded CapData. All fields
 * are on-chain facts; no actor-class judgement here (that is derived downstream).
 */
export interface WalletActionSummary {
  readonly kind: WalletActionKind;
  /** Raw action method string: "executeOffer" | "tryExitOffer" | "invokeEntry" | … */
  readonly method: string | null;
  /** Client-chosen offer id (executeOffer/tryExitOffer); opaque, used only for continuity. */
  readonly offerId: string | null;
  readonly source: OfferSource;
  /** Target Zoe Instance board id when source is contract/purse (resolvable to a contract name). */
  readonly instanceBoardId: string | null;
  /** Dotted agoricNames path when source is agoricContract (e.g. "psm.IST.USDC"). */
  readonly instancePath: string | null;
  /** Invitation maker: publicInvitationMaker | invitationMakerName | callPipe[0][0] | null. */
  readonly maker: string | null;
  /** Human description on a purse-sourced invitation, when present. */
  readonly description: string | null;
  /** True when acting on an existing seat (source=continuing or a previousOffer is referenced). */
  readonly isContinuing: boolean;
  readonly give: readonly OfferLeg[];
  readonly want: readonly OfferLeg[];
  /** wallet_invocation only: message.targetName (e.g. "evmWalletHandler"). */
  readonly targetName: string | null;
  /** wallet_invocation only: message.method (e.g. "handleMessage"). */
  readonly invokeMethod: string | null;
}
