import { describe, expect, it } from "vitest";
import { resolveDenom } from "./resolveDenom";

describe("resolveDenom", () => {
  it("resolves native BLD", () => {
    const m = resolveDenom("ubld");
    expect(m).not.toBeNull();
    expect(m?.displaySymbol).toBe("BLD");
    expect(m?.decimals).toBe(6);
    expect(m?.coingeckoId).toBe("agoric");
  });

  it("returns null for unknown denom", () => {
    expect(resolveDenom("ibc/UNKNOWN00000000000000000000000000000000000000000000000000")).toBeNull();
  });

  it("preserves coingeckoId as empty when omitted in config", () => {
    const m = resolveDenom("ufastlp");
    expect(m).not.toBeNull();
    expect(m?.coingeckoId).toBe("");
  });
});
