import { describe, expect, it } from "vitest";
import { chartTheme } from "./chartTheme";

describe("chartTheme", () => {
  it("exports trend line stroke props for OLS overlays", () => {
    expect(chartTheme.trendLineProps.strokeDasharray).toBe("5 5");
    expect(chartTheme.trendLineProps.strokeWidth).toBe(1.5);
  });

  it("keeps distinguishable series stroke tokens", () => {
    expect(chartTheme.lineA).toMatch(/^#/);
    expect(chartTheme.lineB).not.toBe(chartTheme.lineA);
  });
});
