import { describe, expect, it } from "vitest";
import { walletActionRollupDeltas, MAX_DIMENSION_LEN } from "@/lib/walletOfferRollup";
import { SERIES } from "@/lib/semantics";
import type { WalletActionSummary } from "@/lib/walletOfferTypes";

function summary(overrides: Partial<WalletActionSummary>): WalletActionSummary {
  return {
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
    ...overrides,
  };
}

function dims(deltas: { series: string; dimension: string }[], series: string): string[] {
  return deltas.filter((d) => d.series === series).map((d) => d.dimension);
}

describe("walletActionRollupDeltas", () => {
  it("emits wallet_actions + offer_category + offer_source/instance/maker for a contract offer", () => {
    const deltas = walletActionRollupDeltas(
      summary({
        kind: "zoe_offer",
        source: "contract",
        instanceBoardId: "board02568",
        maker: "makeGiveMintedInvitation",
      }),
      "psm-IST-USDC_grv"
    );
    expect(dims(deltas, SERIES.WALLET_ACTIONS)).toEqual(["zoe_offer"]);
    expect(dims(deltas, SERIES.OFFER_CATEGORY)).toEqual(["psm"]);
    expect(dims(deltas, SERIES.OFFER_SOURCE)).toEqual(["contract"]);
    expect(dims(deltas, SERIES.OFFER_INSTANCE)).toEqual(["board02568"]);
    expect(dims(deltas, SERIES.OFFER_MAKER)).toEqual(["makeGiveMintedInvitation"]);
    expect(dims(deltas, SERIES.INVOKE_TARGET)).toEqual([]);
  });

  it("categorizes an instance-less continuing settlement offer via maker", () => {
    const deltas = walletActionRollupDeltas(
      summary({ kind: "zoe_offer", source: "continuing", maker: "SettleTransaction", isContinuing: true })
    );
    expect(dims(deltas, SERIES.OFFER_CATEGORY)).toEqual(["fast_usdc"]);
    expect(dims(deltas, SERIES.OFFER_SOURCE)).toEqual(["continuing"]);
    expect(dims(deltas, SERIES.OFFER_INSTANCE)).toEqual([]);
    expect(dims(deltas, SERIES.OFFER_MAKER)).toEqual(["SettleTransaction"]);
  });

  it("emits invoke_target + category for a wallet invocation (evmWalletHandler is a YMax user → ymax)", () => {
    const deltas = walletActionRollupDeltas(
      summary({ kind: "wallet_invocation", targetName: "evmWalletHandler" })
    );
    expect(dims(deltas, SERIES.WALLET_ACTIONS)).toEqual(["wallet_invocation"]);
    expect(dims(deltas, SERIES.OFFER_CATEGORY)).toEqual(["ymax"]);
    expect(dims(deltas, SERIES.INVOKE_TARGET)).toEqual(["evmWalletHandler"]);
    expect(dims(deltas, SERIES.OFFER_SOURCE)).toEqual([]);
  });

  it("counts an unknown action under wallet_actions + other category", () => {
    const deltas = walletActionRollupDeltas(summary({ kind: "unknown" }));
    expect(dims(deltas, SERIES.WALLET_ACTIONS)).toEqual(["unknown"]);
    expect(dims(deltas, SERIES.OFFER_CATEGORY)).toEqual(["other"]);
  });

  it("clamps an over-long dimension to the column width", () => {
    const long = "board" + "x".repeat(700);
    const deltas = walletActionRollupDeltas(
      summary({ kind: "zoe_offer", source: "contract", instanceBoardId: long })
    );
    expect(dims(deltas, SERIES.OFFER_INSTANCE)[0]!.length).toBe(MAX_DIMENSION_LEN);
  });
});
