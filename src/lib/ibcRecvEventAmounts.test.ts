import { describe, expect, it } from "vitest";
import {
  countUniqueRecvFlowsFromTxEvents,
  diagnoseRecvCoinAmountsByEventType,
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

  it("adds coin_received and transfer amounts for the same denom when both appear (additive model)", () => {
    const m = sumRecvCoinAmountsFromTxEvents([
      {
        type: "coin_received",
        attributes: [
          { key: "msg_index", value: "0" },
          { key: "amount", value: "50ubld" },
        ],
      },
      {
        type: "transfer",
        attributes: [
          { key: "msg_index", value: "0" },
          { key: "amount", value: "50ubld" },
        ],
      },
    ]);
    expect(m.get("ubld")).toBe(BigInt(100));
  });
});

describe("diagnoseRecvCoinAmountsByEventType", () => {
  it("combined map matches sumRecvCoinAmountsFromTxEvents", () => {
    const recvIdx = new Set([0]);
    const events = [
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
    ];
    const d = diagnoseRecvCoinAmountsByEventType(events, { recvPacketMsgIndices: recvIdx });
    expect(d.combined).toEqual(sumRecvCoinAmountsFromTxEvents(events, { recvPacketMsgIndices: recvIdx }));
    expect(d.fromCoinReceived.get("ubld")).toBe(BigInt(100));
    expect(d.fromTransfer.size).toBe(0);
    expect(d.usedMsgIndexFilter).toBe(true);
    expect(d.usedLegacyFallback).toBe(false);
  });

  it("splits coin_received vs transfer when msg_index filter is attempted then legacy applies", () => {
    const recvIdx = new Set([0]);
    const events = [
      {
        type: "coin_received",
        attributes: [
          { key: "msg_index", value: "1" },
          { key: "amount", value: "50ubld" },
        ],
      },
      {
        type: "transfer",
        attributes: [
          { key: "msg_index", value: "1" },
          { key: "amount", value: "50ubld" },
        ],
      },
    ];
    const d = diagnoseRecvCoinAmountsByEventType(events, { recvPacketMsgIndices: recvIdx });
    expect(d.combined.get("ubld")).toBe(BigInt(100));
    expect(d.fromCoinReceived.get("ubld")).toBe(BigInt(50));
    expect(d.fromTransfer.get("ubld")).toBe(BigInt(50));
    expect(d.usedLegacyFallback).toBe(true);
    expect(d.usedMsgIndexFilter).toBe(false);
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
