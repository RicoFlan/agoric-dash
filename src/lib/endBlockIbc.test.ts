import { describe, expect, it } from "vitest";
import { endBlockIbcSends, ibcDenomFromTrace, parseSendPacketEvent } from "@/lib/endBlockIbc";

const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
const send = (data: object, extra: Record<string, string> = {}) => ({
  type: "send_packet",
  attributes: Object.entries({ packet_data_hex: hex(JSON.stringify(data)), packet_src_port: "transfer", packet_src_channel: "channel-62", ...extra }).map(([key, value]) => ({ key, value })),
});

describe("ibcDenomFromTrace", () => {
  it("maps the Noble USDC trace to the on-chain voucher id used everywhere else", () => {
    // published denom for USDC (Noble) on agoric-3
    expect(ibcDenomFromTrace("transfer/channel-62/uusdc")).toBe("ibc/FE98AAD68F02F03565E9FA39A5E627946699B2B07115889ED812D8BA639576A9");
    expect(ibcDenomFromTrace("ubld")).toBe("ubld");
  });
});

describe("parseSendPacketEvent / endBlockIbcSends", () => {
  it("decodes packet_data_hex into denom, amount, sender", () => {
    const s = parseSendPacketEvent(send({ denom: "transfer/channel-62/uusdc", amount: "1150000", sender: "agoric1lca", receiver: "noble1x" }));
    expect(s).toEqual({ denom: "ibc/FE98AAD68F02F03565E9FA39A5E627946699B2B07115889ED812D8BA639576A9", amount: BigInt(1150000), sender: "agoric1lca", receiver: "noble1x", srcChannel: "channel-62" });
  });

  it("keeps EndBlock/BeginBlock sends and drops tx-mode or non-transfer packets", () => {
    const sends = endBlockIbcSends([
      send({ denom: "ubld", amount: "5000000", sender: "a", receiver: "b" }, { mode: "EndBlock" }),
      send({ denom: "ubld", amount: "7", sender: "a", receiver: "b" }, { mode: "DeliverTx" }),
      send({ denom: "ubld", amount: "9", sender: "a", receiver: "b" }, { packet_src_port: "icacontroller-1" }),
      send({ denom: "ubld", amount: "0", sender: "a", receiver: "b" }),
      { type: "transfer", attributes: [] },
    ]);
    expect(sends.map((s) => s.amount.toString())).toEqual(["5000000"]);
  });

  it("returns null for malformed packets", () => {
    expect(parseSendPacketEvent({ type: "send_packet", attributes: [{ key: "packet_src_port", value: "transfer" }, { key: "packet_data_hex", value: "zz" }] })).toBeNull();
    expect(parseSendPacketEvent(send({ denom: "ubld", amount: "1.5" }))).toBeNull();
  });
});
