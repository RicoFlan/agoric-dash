import { describe, expect, it } from "vitest";
import { MSG_IBC_TRANSFER } from "@/lib/semantics";
import { attributedTransferLegsFromDecodedMsg } from "@/lib/transferVolumeAttribution";

describe("attributedTransferLegsFromDecodedMsg", () => {
  it("attributes MsgSend from from_address", () => {
    const legs = attributedTransferLegsFromDecodedMsg("/cosmos.bank.v1beta1.MsgSend", {
      from_address: "agoric1aaa",
      amount: [{ denom: "uist", amount: "1000" }],
    });
    expect(legs).toEqual([
      { address: "agoric1aaa", denom: "uist", amount: BigInt(1000) },
    ]);
  });

  it("attributes MsgMultiSend inputs", () => {
    const legs = attributedTransferLegsFromDecodedMsg("/cosmos.bank.v1beta1.MsgMultiSend", {
      inputs: [
        {
          address: "agoric1inp",
          coins: [{ denom: "ubld", amount: "500" }],
        },
      ],
      outputs: [],
    });
    expect(legs).toEqual([{ address: "agoric1inp", denom: "ubld", amount: BigInt(500) }]);
  });

  it("attributes IBC transfer sender + token", () => {
    const legs = attributedTransferLegsFromDecodedMsg(MSG_IBC_TRANSFER, {
      sender: "agoric1ibc",
      token: { denom: "ibc/ABC", amount: "42" },
    });
    expect(legs).toEqual([{ address: "agoric1ibc", denom: "ibc/ABC", amount: BigInt(42) }]);
  });
});
