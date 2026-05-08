import { describe, expect, it } from "vitest";
import { linearTrendLine } from "./linearTrend";

describe("linearTrendLine", () => {
  it("returns empty for empty input", () => {
    expect(linearTrendLine([])).toEqual([]);
  });

  it("is flat for a single point", () => {
    expect(linearTrendLine([5])).toEqual([5]);
  });

  it("fits a straight line through two points", () => {
    expect(linearTrendLine([0, 10])).toEqual([0, 10]);
    expect(linearTrendLine([10, 10])).toEqual([10, 10]);
  });

  it("matches known slope for evenly spaced indices", () => {
    const y = [0, 1, 2, 3, 4];
    const t = linearTrendLine(y);
    expect(t.every((v, i) => Math.abs(v - i) < 1e-9)).toBe(true);
  });

  it("ignores non-finite values when fitting", () => {
    const y = [0, Number.NaN, 4];
    const t = linearTrendLine(y);
    expect(t.length).toBe(3);
    expect(t[0]).toBeCloseTo(0);
    expect(t[1]).toBeCloseTo(2);
    expect(t[2]).toBeCloseTo(4);
  });
});
