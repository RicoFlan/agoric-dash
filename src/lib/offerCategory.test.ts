import { describe, expect, it } from "vitest";
import { categoryAutomation, classifyOfferCategory } from "@/lib/offerCategory";
import type { OfferCategoryInput } from "@/lib/offerCategory";

function input(overrides: Partial<OfferCategoryInput>): OfferCategoryInput {
  return { kind: "zoe_offer", source: "contract", instanceName: null, maker: null, targetName: null, ...overrides };
}

describe("classifyOfferCategory", () => {
  it("classifies invokeEntry as orchestration, except YMax's EVM-wallet handler (a user)", () => {
    expect(classifyOfferCategory(input({ kind: "wallet_invocation", targetName: "planner" }))).toBe("orchestration");
    expect(classifyOfferCategory(input({ kind: "wallet_invocation", targetName: "evmWalletHandler" }))).toBe("ymax");
  });

  it("maps real instance names to functional categories", () => {
    const cases: Array<[string, string]> = [
      ["ATOM-USD price feed", "oracle"],
      ["scaledPriceAuthority-ATOM", "oracle"],
      ["economicCommittee", "governance"],
      ["econCommitteeCharter", "governance"],
      ["VaultFactoryGovernor", "governance"],
      ["VaultFactory", "vaults"],
      ["psm-IST-USDC_grv", "psm"],
      ["auctioneer", "auction"],
      ["reserve", "auction"],
      ["fastUsdc", "fast_usdc"],
      ["ymax0", "ymax"],
      ["kread", "other"],
    ];
    for (const [name, expected] of cases) {
      expect(classifyOfferCategory(input({ instanceName: name }))).toBe(expected);
    }
  });

  it("falls back to maker for instance-less (continuing) offers", () => {
    expect(classifyOfferCategory(input({ source: "continuing", maker: "SettleTransaction" }))).toBe("fast_usdc");
    expect(classifyOfferCategory(input({ source: "continuing", maker: "PushPrice" }))).toBe("oracle");
    expect(classifyOfferCategory(input({ source: "continuing", maker: "AdjustBalances" }))).toBe("other");
  });

  it("returns other when nothing is resolvable", () => {
    expect(classifyOfferCategory(input({ source: "unknown", maker: null }))).toBe("other");
  });
});

describe("categoryAutomation", () => {
  it("groups machine-driven categories as automated", () => {
    for (const c of ["orchestration", "oracle", "fast_usdc"] as const) {
      expect(categoryAutomation(c)).toBe("automated");
    }
  });
  it("groups deliberate economic/governance categories as interactive", () => {
    for (const c of ["vaults", "psm", "auction", "governance"] as const) {
      expect(categoryAutomation(c)).toBe("interactive");
    }
  });
  it("leaves other as unknown", () => {
    expect(categoryAutomation("other")).toBe("unknown");
  });

  it("classifies the maker-only makers audited as unique to one contract", () => {
    const continuing = (maker: string) =>
      classifyOfferCategory({ kind: "zoe_offer", source: "continuing", instanceName: null, maker, targetName: null });
    // Fast-USDC settlement and its operator kit: automation, not users.
    expect(continuing("SettleTransaction")).toBe("fast_usdc");
    expect(continuing("SubmitEvidence")).toBe("fast_usdc");
    // The portfolio contract's rebalance, handed to the holder at creation.
    expect(continuing("SimpleRebalance")).toBe("ymax");
  });

  it("leaves Deposit and Withdraw unclassified, because the names are not unique to YMax", () => {
    // LocalOrchestrationAccount exposes invitationMakers named Deposit and Withdraw, so any contract
    // handing out that facet — Fast-USDC included — produces offers with these makers. Classifying
    // on the bare name would file other contracts' activity under ymax with nothing to contradict it.
    const continuing = (maker: string) =>
      classifyOfferCategory({ kind: "zoe_offer", source: "continuing", instanceName: null, maker, targetName: null });
    expect(continuing("Deposit")).toBe("other");
    expect(continuing("Withdraw")).toBe("other");
  });

  it("leaves Rebalance unclassified: a common word, unlike the distinctive coinages we do match", () => {
    // The fourth PortfolioContinuingInvitationMaker, superseded by SimpleRebalance and with zero
    // actions in indexed history. Uniqueness is checkable inside agoric-sdk but not across every
    // contract on mainnet, so the bar is a distinctive name — which "Rebalance" is not.
    const continuing = (maker: string) =>
      classifyOfferCategory({ kind: "zoe_offer", source: "continuing", instanceName: null, maker, targetName: null });
    expect(continuing("Rebalance")).toBe("other");
  });

  it("does not treat inherited object members as categories", () => {
    // `maker` is chain-controlled, so an object-literal lookup would return Object.prototype members
    // as truthy "categories" and write them out as rollup dimensions.
    const continuing = (maker: string) =>
      classifyOfferCategory({ kind: "zoe_offer", source: "continuing", instanceName: null, maker, targetName: null });
    for (const evil of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__", "isPrototypeOf"]) {
      expect(continuing(evil), `${evil} must not classify`).toBe("other");
    }
  });

  it("still prefers a resolvable instance over the maker name", () => {
    // A maker rule must never override the contract the offer actually targeted.
    expect(
      classifyOfferCategory({ kind: "zoe_offer", source: "contract", instanceName: "VaultFactory", maker: "SubmitEvidence", targetName: null })
    ).toBe("vaults");
  });
});