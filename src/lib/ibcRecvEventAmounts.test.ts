import { describe, expect, it } from "vitest";
import { sumRecvCoinAmountsFromTxEvents } from "./ibcRecvEventAmounts";

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
});
