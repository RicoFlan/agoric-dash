import { describe, expect, it } from "vitest";
import {
  decodeVstoragePath,
  extractWalletStreamCells,
  summarizeOfferStatus,
  type VstorageEvent,
} from "@/lib/walletOutcomeSummary";
import { BoardSlot } from "@/lib/walletOfferTypes";

function streamCellEvent(path: string, values: string[]): VstorageEvent {
  return {
    type: "state_change",
    attributes: [
      { key: "store", value: "vstorage" },
      { key: "key", value: path },
      { key: "value", value: JSON.stringify({ blockHeight: "1", values }) },
    ],
  };
}

describe("decodeVstoragePath", () => {
  it("drops leading store-sequence token and returns published.* segments", () => {
    expect(decodeVstoragePath("3\u0000published\u0000wallet\u0000agoric1abc")).toEqual([
      "published",
      "wallet",
      "agoric1abc",
    ]);
  });
});

describe("extractWalletStreamCells", () => {
  it("returns only published.wallet.<addr> vstorage state changes", () => {
    const cells = extractWalletStreamCells([
      streamCellEvent("3\u0000published\u0000wallet\u0000agoric1abc", ["A", "B"]),
      streamCellEvent("4\u0000published\u0000ymax0\u0000portfolios", ["X"]), // not wallet
      { type: "transfer", attributes: [] }, // not state_change
      { type: "state_change", attributes: [{ key: "store", value: "vstorage" }] }, // no key/value
    ]);
    expect(cells).toEqual([{ address: "agoric1abc", capDataStrings: ["A", "B"] }]);
  });

  it("tolerates malformed StreamCell JSON", () => {
    const cells = extractWalletStreamCells([
      {
        type: "state_change",
        attributes: [
          { key: "store", value: "vstorage" },
          { key: "key", value: "3\u0000published\u0000wallet\u0000agoric1abc" },
          { key: "value", value: "{not json" },
        ],
      },
    ]);
    expect(cells).toEqual([]);
  });
});

describe("summarizeOfferStatus", () => {
  it("counts a satisfied offer only at the terminal payouts update", () => {
    // intermediate updates are skipped
    expect(summarizeOfferStatus({ updated: "offerStatus", status: { id: "o1", result: "ok" } })).toBeNull();
    expect(
      summarizeOfferStatus({ updated: "offerStatus", status: { id: "o1", numWantsSatisfied: 1 } })
    ).toBeNull();
    // terminal (payouts present)
    expect(
      summarizeOfferStatus({
        updated: "offerStatus",
        status: { id: "o1", numWantsSatisfied: 1, payouts: { Out: { value: "5" } } },
      })
    ).toEqual({
      offerId: "o1",
      outcome: "wants_satisfied",
      payouts: [{ keyword: "Out", brandBoardId: null, value: "5" }],
      spec: null,
    });
  });

  it("classifies a zero-wants terminal as wants_unsatisfied (refund)", () => {
    expect(
      summarizeOfferStatus({
        updated: "offerStatus",
        status: { id: "o2", numWantsSatisfied: 0, payouts: { In: { value: "10" } } },
      })
    ).toEqual({
      offerId: "o2",
      outcome: "wants_unsatisfied",
      payouts: [{ keyword: "In", brandBoardId: null, value: "10" }],
      spec: null,
    });
  });

  it("classifies a terminal update carrying an error as errored (single count)", () => {
    expect(
      summarizeOfferStatus({
        updated: "offerStatus",
        status: { id: "o3", error: "Error: rejected", payouts: { In: { value: "10" } } },
      })
    ).toEqual({
      offerId: "o3",
      outcome: "errored",
      payouts: [{ keyword: "In", brandBoardId: null, value: "10" }],
      spec: null,
    });
  });

  it("echoes the offer's own invitationSpec as a summary for category classification", () => {
    const fact = summarizeOfferStatus({
      updated: "offerStatus",
      status: {
        id: "o5",
        invitationSpec: { source: "contract", instance: new BoardSlot("board0188", "InstanceHandle"), publicInvitationMaker: "makeVaultInvitation" },
        proposal: { give: { Collateral: { brand: new BoardSlot("board0001", "ATOM brand"), value: "1000" } }, want: {} },
        numWantsSatisfied: 1,
        payouts: {},
      },
    });
    expect(fact?.spec).toMatchObject({
      kind: "zoe_offer",
      source: "contract",
      instanceBoardId: "board0188",
      maker: "makeVaultInvitation",
      give: [{ keyword: "Collateral", brandBoardId: "board0001", value: "1000" }],
    });
  });

  it("extracts payout leg brand board id from a BoardSlot", () => {
    const fact = summarizeOfferStatus({
      updated: "offerStatus",
      status: {
        id: "o4",
        numWantsSatisfied: 1,
        payouts: { Minted: { brand: new BoardSlot("board0257", "IST brand"), value: "215000" } },
      },
    });
    expect(fact?.payouts).toEqual([{ keyword: "Minted", brandBoardId: "board0257", value: "215000" }]);
  });

  it("ignores non-offerStatus updates (invocation/balance)", () => {
    expect(summarizeOfferStatus({ updated: "invocation", result: "ok" })).toBeNull();
    expect(summarizeOfferStatus({ updated: "balance" })).toBeNull();
    expect(summarizeOfferStatus(null)).toBeNull();
  });
});
