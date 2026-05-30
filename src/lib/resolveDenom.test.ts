import { describe, expect, it } from "vitest";
import { resolveDenom } from "./resolveDenom";

describe("resolveDenom", () => {
  it("resolves native BLD", () => {
    const m = resolveDenom("ubld");
    expect(m).not.toBeNull();
    expect(m?.displaySymbol).toBe("BLD");
    expect(m?.decimals).toBe(6);
  });

  it("returns null for unknown denom", () => {
    expect(resolveDenom("ibc/UNKNOWN00000000000000000000000000000000000000000000000000")).toBeNull();
  });

  it("resolves entry without extra keys", () => {
    const m = resolveDenom("ufastlp");
    expect(m).not.toBeNull();
    expect(m?.displaySymbol).toBe("Fast LP");
  });

  it("resolves an IBC hash added from chain bank metadata (chain-disambiguated label)", () => {
    const m = resolveDenom(
      "ibc/010704EDB319E4141299BBCB1CD8790362910509330824B88049DE3CE5D0A7AD"
    );
    expect(m).not.toBeNull();
    expect(m?.displaySymbol).toBe("USDC (Axelar)");
    expect(m?.decimals).toBe(6);
  });

  it("disambiguates same-symbol IBC denoms by origin chain (Noble vs Gravity Bridge USDC)", () => {
    expect(
      resolveDenom("ibc/FE98AAD68F02F03565E9FA39A5E627946699B2B07115889ED812D8BA639576A9")?.displaySymbol
    ).toBe("USDC (Noble)");
    expect(
      resolveDenom("ibc/6831292903487E58BF9A195FDDC8A2E626B3DF39B88F4E7F41C935CADBAF54AC")?.displaySymbol
    ).toBe("USDC (Gravity Bridge)");
  });
});
