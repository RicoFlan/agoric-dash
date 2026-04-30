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

  it("resolves an IBC hash added from chain bank metadata", () => {
    const m = resolveDenom(
      "ibc/010704EDB319E4141299BBCB1CD8790362910509330824B88049DE3CE5D0A7AD"
    );
    expect(m).not.toBeNull();
    expect(m?.displaySymbol).toBe("USDC");
    expect(m?.decimals).toBe(6);
  });
});
