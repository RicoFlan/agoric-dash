import { describe, expect, it } from "vitest";
import { METRIC_DICTIONARY } from "@/lib/metricDictionary";
import {
  INDEXER_SCOPE_CAVEAT_INLINE,
  INDEXER_SCOPE_CAVEAT_SUBTITLE,
  METHODOLOGY_BLURB,
  METHODOLOGY_SECTIONS,
  SERIES,
  TX_RESULT_ROLLUP_POLICY,
} from "@/lib/semantics";

describe("TX_RESULT_ROLLUP_POLICY", () => {
  it("matches metric dictionary success scopes for gas and fees", () => {
    expect(TX_RESULT_ROLLUP_POLICY.gasUsed).toBe("includes_failed_and_successful");
    expect(TX_RESULT_ROLLUP_POLICY.feePaid).toBe("successful_only");

    const gas = METRIC_DICTIONARY.find((d) => d.seriesKey === SERIES.GAS_USED);
    const fee = METRIC_DICTIONARY.find((d) => d.seriesKey === SERIES.FEE_PAID);
    expect(gas?.successScope).toBe("every_indexed_tx");
    expect(fee?.successScope).toBe("successful_tx_only");
  });
});

describe("INDEXER_SCOPE_CAVEAT_*", () => {
  it("inline string splits once on Methodology for Dashboard anchor rendering", () => {
    const parts = INDEXER_SCOPE_CAVEAT_INLINE.split("Methodology");
    expect(parts.length).toBe(2);
    expect(parts[0]).toContain("Tx-attributed only");
    expect(parts[1]).toMatch(/^\)\./);
  });

  it("subtitle variant stays compact and aligned with inline meaning", () => {
    expect(INDEXER_SCOPE_CAVEAT_SUBTITLE).toContain("Tx-attributed only");
    expect(INDEXER_SCOPE_CAVEAT_SUBTITLE).toContain("inflation");
    expect(INDEXER_SCOPE_CAVEAT_SUBTITLE.length).toBeLessThan(INDEXER_SCOPE_CAVEAT_INLINE.length);
  });
});

describe("METHODOLOGY_SECTIONS", () => {
  it("has unique titled sections with non-empty bodies", () => {
    expect(METHODOLOGY_SECTIONS.length).toBeGreaterThanOrEqual(10);
    const titles = METHODOLOGY_SECTIONS.map((s) => s.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const s of METHODOLOGY_SECTIONS) {
      expect(s.title.trim().length).toBeGreaterThan(0);
      expect(s.body.trim().length).toBeGreaterThan(0);
    }
  });

  it("includes core dashboard UX section titles", () => {
    const titles = METHODOLOGY_SECTIONS.map((s) => s.title);
    expect(titles).toContain("Layout");
    expect(titles).toContain("Value handled table");
    expect(titles).toContain("Value Flow Map");
    expect(titles).toContain("Trend overlays");
  });

  it("METHODOLOGY_BLURB matches joined sections", () => {
    const joined = METHODOLOGY_SECTIONS.map((s) => `${s.title}: ${s.body}`).join("\n\n");
    expect(METHODOLOGY_BLURB).toBe(joined);
  });
});

describe("METHODOLOGY_BLURB", () => {
  it("documents the combined Value handled table, View Denom UX, and non-additive framing", () => {
    expect(METHODOLOGY_BLURB).toContain("Value by denom: gross in-tx vs bank credits");
    expect(METHODOLOGY_BLURB).toContain("View Denom");
    expect(METHODOLOGY_BLURB).toContain("document.body");
    expect(METHODOLOGY_BLURB).toMatch(/not additive|non-additive/i);
  });

  it("documents Value Flow Map layout and charts (replaces multi-asset value line charts)", () => {
    expect(METHODOLOGY_BLURB).toContain("Value Flow Map");
    expect(METHODOLOGY_BLURB).toContain("Gross composition");
    expect(METHODOLOGY_BLURB).toContain("Credits vs outbound IBC");
    expect(METHODOLOGY_BLURB).toContain("Momentum (last vs first bucket)");
    expect(METHODOLOGY_BLURB).not.toMatch(/gross in-tx movement line chart/i);
    expect(METHODOLOGY_BLURB).not.toMatch(/IBC amount flows chart/i);
    expect(METHODOLOGY_BLURB).not.toMatch(/checkbox/i);
  });

  it("documents indexer line, hour fallback, and participation conditional", () => {
    expect(METHODOLOGY_BLURB).toContain("indexer_state");
    expect(METHODOLOGY_BLURB).toContain("hourly_metrics");
    expect(METHODOLOGY_BLURB).toContain("participation and/or concentration");
  });
});
