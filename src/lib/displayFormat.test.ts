import { describe, expect, it } from "vitest";
import type { EnrichedDisplay } from "./metricsDisplayTypes";
import { formatHumanAxisLabel, formatUsd, listRow, valueToChartNumber } from "./displayFormat";

const displayWithBld: EnrichedDisplay = {
  usd: { agoric: 0.1 },
  metas: {
    ubld: { displaySymbol: "BLD", decimals: 6, coingeckoId: "agoric" },
  },
  pricingFromCoinGecko: true,
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

  it("omits USD when includeUsd is false", () => {
    const r = listRow("1000000", "ubld", displayWithBld, { includeUsd: false });
    expect(r.usdLine).toBeNull();
  });

  it("includes USD when includeUsd is true and price exists", () => {
    const r = listRow("1000000", "ubld", displayWithBld, { includeUsd: true });
    expect(r.usdLine).toMatch(/\$/);
  });

  it("passes through raw for unknown denom", () => {
    const r = listRow("99", "ibc/ZZZ", displayWithBld);
    expect(r.amountHuman).toBe("99");
    expect(r.symbol).toBe("");
  });
});

describe("formatUsd", () => {
  it("formats as locale currency (en-US: $ and amount)", () => {
    const s = formatUsd(12.3);
    expect(s).toMatch(/12/);
    expect(s).toMatch(/\$/);
  });
});

describe("formatHumanAxisLabel", () => {
  it("wraps symbol", () => {
    expect(formatHumanAxisLabel("USDC")).toBe("Amount (USDC)");
  });
});
