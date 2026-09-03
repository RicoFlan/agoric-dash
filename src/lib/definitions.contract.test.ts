import { describe, expect, it } from "vitest";
import { DEFINITIONS } from "@/lib/definitions";

describe("DEFINITIONS", () => {
  it("has a non-empty, unique, one-line definition for every indicator id", () => {
    const entries = Object.entries(DEFINITIONS);
    expect(entries.length).toBeGreaterThanOrEqual(16);
    const texts = new Set<string>();
    for (const [id, text] of entries) {
      expect(id).toMatch(/^q[1-4]_[a-z0-9_]+$/);
      expect(text.trim().length).toBeGreaterThan(20);
      expect(text).not.toContain("\n");
      texts.add(text);
    }
    expect(texts.size).toBe(entries.length);
  });

  it("covers each question", () => {
    const ids = Object.keys(DEFINITIONS);
    for (const q of ["q1_", "q2_", "q3_", "q4_"]) expect(ids.some((i) => i.startsWith(q))).toBe(true);
  });
});
