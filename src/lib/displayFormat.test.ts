import { describe, expect, it } from "vitest";
import type { EnrichedDisplay } from "./metricsDisplayTypes";
import { formatHumanAxisLabel, listRow, valueToChartNumber } from "./displayFormat";

const displayWithBld: EnrichedDisplay = {
  metas: {
    ubld: { displaySymbol: "BLD", decimals: 6 },
  },
};

describe("valueToChartNumber", () => {
  it("uses denom meta when present", () => {
    expect(valueToChartNumber("1000000", "ubld", displayWithBld)).toBe(1);
  });

  it("falls back to Number(atomic) when no meta", () => {
    expect(valueToChartNumber("42", "unknown", undefined)).toBe(42);
  });
});

describe("listRow", () => {
  it("formats with symbol when meta exists", () => {
    const r = listRow("1000000", "ubld", displayWithBld);
    expect(r.symbol).toBe("BLD");
    expect(r.amountHuman).toBe("1");
    expect(r.rawDenom).toBe("ubld");
  });

  it("passes through raw for unknown denom", () => {
    const r = listRow("99", "ibc/ZZZ", displayWithBld);
    expect(r.amountHuman).toBe("99");
    expect(r.symbol).toBe("");
  });
});

describe("formatHumanAxisLabel", () => {
  it("wraps symbol", () => {
    expect(formatHumanAxisLabel("USDC")).toBe("Amount (USDC)");
  });
});
