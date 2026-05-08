import { describe, expect, it } from "vitest";
import {
  countUniqueRecvFlowsFromTxEvents,
  sumRecvCoinAmountsFromTxEvents,
} from "./ibcRecvEventAmounts";

describe("sumRecvCoinAmountsFromTxEvents", () => {
  it("merges coin_received amounts per denom", () => {
    const m = sumRecvCoinAmountsFromTxEvents([
      {
        type: "coin_received",
        attributes: [
          { key: "amount", value: "1000ubld" },
          { key: "receiver", value: "agoric1foo" },
        ],
      },
    ]);
    expect(m.get("ubld")).toBe(BigInt(1000));
  });

  it("sums transfer event amounts", () => {
    const m = sumRecvCoinAmountsFromTxEvents([
      { type: "transfer", attributes: [{ key: "amount", value: "5uist" }] },
    ]);
    expect(m.get("uist")).toBe(BigInt(5));
  });

  it("ignores non amount attributes", () => {
    expect(sumRecvCoinAmountsFromTxEvents([{ type: "wasm", attributes: [{ key: "foo", value: "1" }] }])).toEqual(
      new Map()
    );
  });

  it("when msg_index present, restricts to MsgRecvPacket indices", () => {
    const recvIdx = new Set([0]);
    const m = sumRecvCoinAmountsFromTxEvents(
      [
        {
          type: "coin_received",
          attributes: [
            { key: "msg_index", value: "0" },
            { key: "amount", value: "100ubld" },
          ],
        },
        {
          type: "coin_received",
          attributes: [
            { key: "msg_index", value: "1" },
            { key: "amount", value: "999uist" },
          ],
        },
      ],
      { recvPacketMsgIndices: recvIdx }
    );
    expect(m.get("ubld")).toBe(BigInt(100));
    expect(m.has("uist")).toBe(false);
  });

  it("falls back to legacy tx-wide sum when filtering yields nothing but amounts exist", () => {
    const recvIdx = new Set([0]);
    const m = sumRecvCoinAmountsFromTxEvents(
      [
        {
          type: "coin_received",
          attributes: [{ key: "amount", value: "50ubld" }],
        },
      ],
      { recvPacketMsgIndices: recvIdx }
    );
    expect(m.get("ubld")).toBe(BigInt(50));
  });
});

describe("countUniqueRecvFlowsFromTxEvents", () => {
  it("counts distinct packet_sequence per recv_packet event", () => {
    expect(
      countUniqueRecvFlowsFromTxEvents([
        {
          type: "recv_packet",
          attributes: [
            { key: "packet_dst_port", value: "transfer" },
            { key: "packet_dst_channel", value: "channel-5" },
            { key: "packet_sequence", value: "42" },
          ],
        },
        {
          type: "recv_packet",
          attributes: [
            { key: "packet_dst_port", value: "transfer" },
            { key: "packet_dst_channel", value: "channel-5" },
            { key: "packet_sequence", value: "43" },
          ],
        },
      ])
    ).toBe(2);
  });

  it("dedupes duplicate recv_packet event for same channel+sequence", () => {
    const ev = {
      type: "recv_packet",
      attributes: [
        { key: "packet_dst_channel", value: "channel-1" },
        { key: "packet_sequence", value: "7" },
      ],
    };
    expect(countUniqueRecvFlowsFromTxEvents([ev, ev])).toBe(1);
  });

  it("returns 0 when no recv_packet events", () => {
    expect(countUniqueRecvFlowsFromTxEvents([{ type: "coin_received", attributes: [] }])).toBe(0);
  });
});
