import { describe, expect, it } from "vitest";
import { categoryAutomation, classifyOfferCategory } from "@/lib/offerCategory";
import type { OfferCategoryInput } from "@/lib/offerCategory";

function input(overrides: Partial<OfferCategoryInput>): OfferCategoryInput {
  return { kind: "zoe_offer", source: "contract", instanceName: null, maker: null, targetName: null, ...overrides };
}

describe("classifyOfferCategory", () => {
  it("classifies invokeEntry as orchestration regardless of other fields", () => {
    expect(classifyOfferCategory(input({ kind: "wallet_invocation", targetName: "planner" }))).toBe("orchestration");
    expect(classifyOfferCategory(input({ kind: "wallet_invocation", targetName: "evmWalletHandler" }))).toBe("orchestration");
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
      ["ymax0", "orchestration"],
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
});
