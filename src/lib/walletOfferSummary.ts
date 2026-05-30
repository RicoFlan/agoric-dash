/**
 * Pure extraction of objective fields from a decoded smart-wallet action (see walletOfferTypes.ts).
 * Input is the PLAIN structure produced by `parseWalletActionString` (BoardSlot markers + string
 * amounts) — but this module has no @endo / I/O dependency, so it is fully unit-testable with
 * hand-constructed fixtures.
 *
 * Shapes handled (confirmed against mainnet in Phase 0b):
 *  - executeOffer: { method, offer: { id, invitationSpec, proposal: { give, want }, offerArgs } }
 *  - tryExitOffer: { method, offer: { id } }
 *  - invokeEntry:  { method, message: { id, targetName, method, args } }   (NOT a Zoe offer)
 *
 * invitationSpec variants:
 *  - { source: "contract",        instance: <Instance>, publicInvitationMaker }
 *  - { source: "agoricContract",  instancePath: [...], callPipe: [[maker, args?], …] }
 *  - { source: "continuing",      previousOffer, invitationMakerName }
 *  - { source: "purse",           instance: <Instance>, description }
 */
import {
  BoardSlot,
  type OfferLeg,
  type OfferSource,
  type WalletActionKind,
  type WalletActionSummary,
} from "@/lib/walletOfferTypes";

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function boardIdOf(v: unknown): string | null {
  return v instanceof BoardSlot ? v.boardId : null;
}

function kindForMethod(method: string | null): WalletActionKind {
  if (method === "executeOffer" || method === "tryExitOffer") return "zoe_offer";
  if (method === "invokeEntry") return "wallet_invocation";
  return "unknown";
}

function normalizeSource(raw: string | null): OfferSource {
  switch (raw) {
    case "contract":
    case "agoricContract":
    case "continuing":
    case "purse":
      return raw;
    default:
      return "unknown";
  }
}

/** Maker name from an invitationSpec across its variants. */
function makerOf(spec: Record<string, unknown>, source: OfferSource): string | null {
  const pub = asString(spec.publicInvitationMaker);
  if (pub) return pub;
  const cont = asString(spec.invitationMakerName);
  if (cont) return cont;
  if (source === "agoricContract" && Array.isArray(spec.callPipe)) {
    const first = (spec.callPipe as unknown[])[0];
    if (Array.isArray(first) && typeof first[0] === "string") return first[0];
  }
  return null;
}

/** Dotted agoricNames path from instancePath array (e.g. ["psm","IST","USDC"] → "psm.IST.USDC"). */
function instancePathOf(spec: Record<string, unknown>): string | null {
  const p = spec.instancePath;
  if (!Array.isArray(p) || p.length === 0) return null;
  return p.map((seg) => String(seg)).join(".");
}

function legsFrom(part: unknown): OfferLeg[] {
  const rec = asRecord(part);
  const out: OfferLeg[] = [];
  for (const [keyword, amt] of Object.entries(rec)) {
    const a = asRecord(amt);
    const value = a.value;
    out.push({
      keyword,
      brandBoardId: boardIdOf(a.brand),
      value: typeof value === "string" ? value : value == null ? null : String(value),
    });
  }
  return out;
}

const EMPTY_SUMMARY: WalletActionSummary = {
  kind: "unknown",
  method: null,
  offerId: null,
  source: "unknown",
  instanceBoardId: null,
  instancePath: null,
  maker: null,
  description: null,
  isContinuing: false,
  give: [],
  want: [],
  targetName: null,
  invokeMethod: null,
};

/** Extract the objective {@link WalletActionSummary} from a plain decoded wallet action. */
export function summarizeWalletAction(plain: unknown): WalletActionSummary {
  const action = asRecord(plain);
  const method = asString(action.method);
  const kind = kindForMethod(method);

  if (kind === "wallet_invocation") {
    const message = asRecord(action.message);
    return {
      ...EMPTY_SUMMARY,
      kind,
      method,
      offerId: asString(message.id),
      targetName: asString(message.targetName),
      invokeMethod: asString(message.method),
    };
  }

  // zoe_offer (or unknown shaped like one)
  const offer = asRecord(action.offer);
  const spec = asRecord(offer.invitationSpec);
  const source = normalizeSource(asString(spec.source));
  const proposal = asRecord(offer.proposal);
  const previousOffer = asString(spec.previousOffer);

  return {
    kind,
    method,
    offerId: offer.id == null ? null : String(offer.id),
    source,
    instanceBoardId: boardIdOf(spec.instance),
    instancePath: instancePathOf(spec),
    maker: makerOf(spec, source),
    description: asString(spec.description),
    isContinuing: source === "continuing" || previousOffer != null,
    give: legsFrom(proposal.give),
    want: legsFrom(proposal.want),
    targetName: null,
    invokeMethod: null,
  };
}
