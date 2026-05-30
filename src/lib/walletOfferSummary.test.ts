import { describe, expect, it } from "vitest";
import { summarizeWalletAction } from "@/lib/walletOfferSummary";
import { BoardSlot } from "@/lib/walletOfferTypes";

/**
 * Fixtures mirror the PLAIN structures `parseWalletActionString` produces for real mainnet actions
 * (shapes captured in the Phase 0b spike): remotables → BoardSlot, bigint amounts → decimal strings.
 */

describe("summarizeWalletAction — zoe offers", () => {
  it("decodes a fresh `contract`-sourced PSM swap (real shape, height 25670088)", () => {
    const plain = {
      method: "executeOffer",
      offer: {
        id: 1780102378371,
        invitationSpec: {
          instance: new BoardSlot("board02568", "InstanceHandle"),
          publicInvitationMaker: "makeGiveMintedInvitation",
          source: "contract",
        },
        offerArgs: undefined,
        proposal: {
          give: { In: { brand: new BoardSlot("board0257", "IST brand"), value: "100000" } },
          want: { Out: { brand: new BoardSlot("board03138", "USDC brand"), value: "100000" } },
        },
      },
    };
    const s = summarizeWalletAction(plain);
    expect(s.kind).toBe("zoe_offer");
    expect(s.method).toBe("executeOffer");
    expect(s.source).toBe("contract");
    expect(s.instanceBoardId).toBe("board02568");
    expect(s.maker).toBe("makeGiveMintedInvitation");
    expect(s.isContinuing).toBe(false);
    expect(s.give).toEqual([{ keyword: "In", brandBoardId: "board0257", value: "100000" }]);
    expect(s.want).toEqual([{ keyword: "Out", brandBoardId: "board03138", value: "100000" }]);
    expect(s.offerId).toBe("1780102378371");
  });

  it("decodes a `continuing` SettleTransaction offer (real shape, height 25667466)", () => {
    const plain = {
      method: "executeOffer",
      offer: {
        id: "offer-2026-05-29T20:51:47.937Z",
        invitationSpec: {
          invitationMakerName: "SettleTransaction",
          previousOffer: "redeem-2025-10-08T04:30:45.658Z",
          source: "continuing",
        },
        offerArgs: { status: "success", txId: "tx6763" },
        proposal: {},
      },
    };
    const s = summarizeWalletAction(plain);
    expect(s.kind).toBe("zoe_offer");
    expect(s.source).toBe("continuing");
    expect(s.maker).toBe("SettleTransaction");
    expect(s.isContinuing).toBe(true);
    expect(s.instanceBoardId).toBeNull();
    expect(s.give).toEqual([]);
    expect(s.want).toEqual([]);
  });

  it("decodes an `agoricContract`-sourced offer via callPipe maker + instancePath", () => {
    const plain = {
      method: "executeOffer",
      offer: {
        id: "open-1",
        invitationSpec: {
          source: "agoricContract",
          instancePath: ["reserve"],
          callPipe: [["makeAddCollateralInvitation"]],
        },
        proposal: {
          give: { Collateral: { brand: new BoardSlot("board0BLD", "BLD brand"), value: "5000000" } },
          want: {},
        },
      },
    };
    const s = summarizeWalletAction(plain);
    expect(s.kind).toBe("zoe_offer");
    expect(s.source).toBe("agoricContract");
    expect(s.instancePath).toBe("reserve");
    expect(s.maker).toBe("makeAddCollateralInvitation");
    expect(s.give).toEqual([{ keyword: "Collateral", brandBoardId: "board0BLD", value: "5000000" }]);
  });

  it("decodes a `purse`-sourced invitation (description maker context)", () => {
    const plain = {
      method: "executeOffer",
      offer: {
        id: "accept-1",
        invitationSpec: {
          source: "purse",
          instance: new BoardSlot("board0gov", "InstanceHandle"),
          description: "charter member invitation",
        },
        proposal: {},
      },
    };
    const s = summarizeWalletAction(plain);
    expect(s.source).toBe("purse");
    expect(s.instanceBoardId).toBe("board0gov");
    expect(s.description).toBe("charter member invitation");
  });

  it("decodes a tryExitOffer (no invitationSpec/proposal)", () => {
    const s = summarizeWalletAction({ method: "tryExitOffer", offer: { id: "bid-7" } });
    expect(s.kind).toBe("zoe_offer");
    expect(s.method).toBe("tryExitOffer");
    expect(s.source).toBe("unknown");
    expect(s.offerId).toBe("bid-7");
    expect(s.give).toEqual([]);
  });
});

describe("summarizeWalletAction — wallet invocations", () => {
  it("decodes an invokeEntry orchestration action (real shape, height 25667451)", () => {
    const plain = {
      method: "invokeEntry",
      message: {
        id: "invoke-93osbn2sbm5310",
        targetName: "evmWalletHandler",
        method: "handleMessage",
        args: [{ domain: { name: "Permit2", chainId: "8453" } }],
      },
    };
    const s = summarizeWalletAction(plain);
    expect(s.kind).toBe("wallet_invocation");
    expect(s.method).toBe("invokeEntry");
    expect(s.targetName).toBe("evmWalletHandler");
    expect(s.invokeMethod).toBe("handleMessage");
    expect(s.offerId).toBe("invoke-93osbn2sbm5310");
    // not an offer → no source/instance/legs
    expect(s.source).toBe("unknown");
    expect(s.give).toEqual([]);
  });
});

describe("summarizeWalletAction — robustness", () => {
  it("returns an unknown summary for an unrecognized method", () => {
    const s = summarizeWalletAction({ method: "futureThing", offer: {} });
    expect(s.kind).toBe("unknown");
    expect(s.method).toBe("futureThing");
  });

  it("tolerates empty / malformed input without throwing", () => {
    expect(summarizeWalletAction(null).kind).toBe("unknown");
    expect(summarizeWalletAction({}).kind).toBe("unknown");
    expect(summarizeWalletAction({ offer: { invitationSpec: 5 } }).kind).toBe("unknown");
  });

  it("handles multi-keyword give/want with mixed brand presence", () => {
    const s = summarizeWalletAction({
      method: "executeOffer",
      offer: {
        invitationSpec: { source: "contract", instance: new BoardSlot("board1", null), publicInvitationMaker: "m" },
        proposal: {
          give: {
            A: { brand: new BoardSlot("brandA", "A"), value: "1" },
            B: { brand: new BoardSlot("brandB", "B"), value: "2" },
          },
          want: { C: { value: "3" } },
        },
      },
    });
    expect(s.give).toHaveLength(2);
    expect(s.want).toEqual([{ keyword: "C", brandBoardId: null, value: "3" }]);
  });
});
