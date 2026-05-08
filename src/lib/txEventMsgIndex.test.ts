import { describe, expect, it } from "vitest";
import { msgIndicesMatchingTypeUrl, parseMsgIndexFromAttributes } from "./txEventMsgIndex";

describe("parseMsgIndexFromAttributes", () => {
  it("reads decimal msg_index", () => {
    expect(
      parseMsgIndexFromAttributes([
        { key: "msg_index", value: "2" },
        { key: "amount", value: "1ubld" },
      ])
    ).toBe(2);
  });

  it("returns undefined when absent", () => {
    expect(parseMsgIndexFromAttributes([{ key: "amount", value: "1ubld" }])).toBeUndefined();
  });
});

describe("msgIndicesMatchingTypeUrl", () => {
  it("collects indices", () => {
    expect(
      msgIndicesMatchingTypeUrl(
        [
          { typeUrl: "/foo.MsgA" },
          { typeUrl: "/ibc.core.channel.v1.MsgRecvPacket" },
          { typeUrl: "/ibc.core.channel.v1.MsgRecvPacket" },
        ],
        "/ibc.core.channel.v1.MsgRecvPacket"
      )
    ).toEqual(new Set([1, 2]));
  });
});
