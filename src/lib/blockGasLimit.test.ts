import { describe, expect, it } from "vitest";
import { maxGasFromBlockResults } from "@/lib/blockGasLimit";
import type { RpcBlockResultsResponse } from "@/lib/rpc";

function results(maxGas: string | undefined | null): RpcBlockResultsResponse {
  return {
    height: "1",
    consensus_param_updates:
      maxGas === undefined ? undefined : maxGas === null ? null : { block: { max_gas: maxGas } },
  };
}

describe("maxGasFromBlockResults", () => {
  it("reads a positive max_gas", () => {
    expect(maxGasFromBlockResults(results("120000000"))).toBe(BigInt(120000000));
  });

  it("returns null for unlimited (-1)", () => {
    expect(maxGasFromBlockResults(results("-1"))).toBeNull();
  });

  it("returns null for zero", () => {
    expect(maxGasFromBlockResults(results("0"))).toBeNull();
  });

  it("returns null when consensus_param_updates is absent or null", () => {
    expect(maxGasFromBlockResults(results(undefined))).toBeNull();
    expect(maxGasFromBlockResults(results(null))).toBeNull();
  });

  it("returns null for non-numeric values", () => {
    expect(maxGasFromBlockResults(results("abc"))).toBeNull();
  });
});
