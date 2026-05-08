import { describe, expect, it } from "vitest";
import { filterNonZeroTooltipPayload } from "./rechartsTooltip";

describe("filterNonZeroTooltipPayload", () => {
  it("removes zero and nullish values", () => {
    expect(
      filterNonZeroTooltipPayload([
        { value: 0, name: "a" },
        { value: 3, name: "b" },
        { value: null, name: "c" },
        { value: undefined, name: "d" },
      ])
    ).toEqual([{ value: 3, name: "b" }]);
  });

  it("removes NaN", () => {
    expect(filterNonZeroTooltipPayload([{ value: Number.NaN, name: "x" }])).toEqual([]);
  });

  it("keeps negative numbers", () => {
    expect(filterNonZeroTooltipPayload([{ value: -1, name: "trend" }])).toEqual([
      { value: -1, name: "trend" },
    ]);
  });

  it("parses numeric strings", () => {
    expect(filterNonZeroTooltipPayload([{ value: "0", name: "z" }])).toEqual([]);
    expect(filterNonZeroTooltipPayload([{ value: "42", name: "z" }])).toEqual([{ value: "42", name: "z" }]);
  });
});
