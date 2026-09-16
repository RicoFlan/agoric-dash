import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, WCAG_AA_NORMAL_TEXT } from "@/lib/contrast";

/** Read a `--token: #hex;` value out of globals.css so the test tracks the real theme. */
function token(name: string): string {
  const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(css);
  if (!m) throw new Error(`token --${name} not found in globals.css`);
  return m[1]!;
}

/** Every surface that body text can sit on; the lightest one is the binding constraint. */
const BACKGROUNDS = ["color-bg-primary", "color-surface", "color-bg-control"] as const;

describe("theme contrast", () => {
  it("keeps every text token readable on every background at normal size", () => {
    for (const text of ["color-text-primary", "color-text-secondary", "color-text-muted"] as const) {
      for (const bg of BACKGROUNDS) {
        const ratio = contrastRatio(token(text), token(bg));
        expect(
          ratio,
          `--${text} on --${bg} is ${ratio.toFixed(2)}:1, below the ${WCAG_AA_NORMAL_TEXT}:1 needed for text under 18.66px`
        ).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
      }
    }
  });

  it("computes known ratios correctly", () => {
    // The pre-fix pairing, kept as a fixture so the maths itself is pinned.
    expect(contrastRatio("#6b7785", "#161d26")).toBeCloseTo(3.72, 1);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
  });
});
