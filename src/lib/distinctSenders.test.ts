import { describe, expect, it } from "vitest";
import { distinctSendersByDenom } from "@/lib/distinctSenders";

function mapOf(
  entries: Array<[string, Array<[string, bigint]>]>
): Map<string, Map<string, bigint>> {
  return new Map(entries.map(([addr, denoms]) => [addr, new Map(denoms)]));
}

describe("distinctSendersByDenom", () => {
  it("counts each address once per denom it sent", () => {
    const m = mapOf([
      ["addrA", [["uist", BigInt(100)], ["ubld", BigInt(5)]]],
      ["addrB", [["uist", BigInt(50)]]],
    ]);
    expect(distinctSendersByDenom(m)).toEqual({ uist: 2, ubld: 1 });
  });

  it("ignores zero-volume legs", () => {
    const m = mapOf([
      ["addrA", [["uist", BigInt(0)]]],
      ["addrB", [["uist", BigInt(1)]]],
    ]);
    expect(distinctSendersByDenom(m)).toEqual({ uist: 1 });
  });

  it("returns an empty object for no senders", () => {
    expect(distinctSendersByDenom(new Map())).toEqual({});
  });

  it("does not merge denoms across addresses incorrectly", () => {
    const m = mapOf([
      ["addrA", [["ibc/AAA", BigInt(10)]]],
      ["addrB", [["ibc/AAA", BigInt(20)]]],
      ["addrC", [["ibc/BBB", BigInt(30)]]],
    ]);
    expect(distinctSendersByDenom(m)).toEqual({ "ibc/AAA": 2, "ibc/BBB": 1 });
  });
});
