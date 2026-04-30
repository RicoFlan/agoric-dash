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
});
