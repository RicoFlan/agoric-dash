import { describe, expect, it } from "vitest";
import { SERIES_ROLLUP_SOURCE } from "@/lib/rollupSourceHierarchy";
import { SERIES } from "@/lib/semantics";

describe("SERIES_ROLLUP_SOURCE", () => {
  it("documents every SERIES value exactly once", () => {
    const seriesValues = Object.values(SERIES);
    expect(Object.keys(SERIES_ROLLUP_SOURCE).length).toBe(seriesValues.length);
    for (const v of seriesValues) {
      expect(SERIES_ROLLUP_SOURCE[v]).toBeDefined();
    }
  });

  it("has substantive primary lines", () => {
    for (const doc of Object.values(SERIES_ROLLUP_SOURCE)) {
      expect(doc.primary.trim().length).toBeGreaterThan(15);
    }
  });

  it("ibc_transfer_amount_in secondary notes gross index and investigation doc", () => {
    const doc = SERIES_ROLLUP_SOURCE[SERIES.IBC_TRANSFER_AMOUNT_IN];
    expect(doc.secondary).toContain("ibcTransferAmountInEventInvestigation.md");
    expect(doc.secondary).toMatch(/gross|same credit/i);
  });
});
