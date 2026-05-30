import { describe, expect, it } from "vitest";
import denoms from "@/config/denoms.json";

describe("denoms.json contract", () => {
  it("has a note and entries array", () => {
    expect(typeof denoms.note).toBe("string");
    expect(denoms.note.length).toBeGreaterThan(20);
    expect(Array.isArray(denoms.entries)).toBe(true);
    expect(denoms.entries.length).toBeGreaterThan(0);
  });

  it("each entry has match, displaySymbol, decimals", () => {
    for (const e of denoms.entries) {
      expect(typeof e.match).toBe("string");
      expect(e.match.length).toBeGreaterThan(0);
      expect(typeof e.displaySymbol).toBe("string");
      expect(e.displaySymbol.length).toBeGreaterThan(0);
      expect(Number.isInteger(e.decimals)).toBe(true);
      expect(e.decimals).toBeGreaterThanOrEqual(0);
      expect(e.decimals).toBeLessThanOrEqual(36);
    }
  });

  it("has unique match values", () => {
    const matches = denoms.entries.map((e) => e.match);
    expect(new Set(matches).size).toBe(matches.length);
  });

  it("is sorted alphabetically by match (stable diffs, binary search friendly)", () => {
    for (let i = 1; i < denoms.entries.length; i++) {
      const a = denoms.entries[i - 1].match;
      const b = denoms.entries[i].match;
      expect(a.localeCompare(b)).toBeLessThanOrEqual(0);
    }
  });

  it("chain-disambiguates multi-source ibc symbols (no bare USDC/USDT/ATOM/etc.)", () => {
    // Symbols that arrive over several bridges/chains must carry a " (Origin)" tag so duplicate
    // rows are distinguishable (scripts/refreshDenomChains.ts). Native (non-ibc) rows are exempt.
    const MULTI_SOURCE = new Set(["USDC", "USDT", "ATOM", "DAI", "WETH"]);
    for (const e of denoms.entries) {
      if (!e.match.startsWith("ibc/")) continue;
      const base = e.displaySymbol.replace(/\s*\([^)]*\)\s*$/, "").trim();
      if (MULTI_SOURCE.has(base)) {
        expect(e.displaySymbol, `${e.match} should be chain-tagged`).toMatch(/\(.+\)\s*$/);
      }
    }
  });

  it("keeps chain tags compatible with CoinGecko symbol lookup (tag-stripping)", () => {
    // The known multi-source labels must reduce to a base symbol the resolver recognizes.
    const usdc = denoms.entries.find(
      (e) => e.match === "ibc/FE98AAD68F02F03565E9FA39A5E627946699B2B07115889ED812D8BA639576A9"
    );
    expect(usdc?.displaySymbol).toBe("USDC (Noble)");
  });
});
