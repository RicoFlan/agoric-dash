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
    // A fee committed by a successful ante handler survives a failed message execution, so fee_paid
    // spans both outcomes; ante failures emit no fee attribute and so contribute nothing.
    expect(TX_RESULT_ROLLUP_POLICY.feePaid).toBe("includes_failed_and_successful");

    const gas = METRIC_DICTIONARY.find((d) => d.seriesKey === SERIES.GAS_USED);
    const fee = METRIC_DICTIONARY.find((d) => d.seriesKey === SERIES.FEE_PAID);
    expect(gas?.successScope).toBe("every_indexed_tx");
    expect(fee?.successScope).toBe("every_indexed_tx");
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
  it("documents the bank-credits value table, day-priced USD, and non-additive framing", () => {
    expect(METHODOLOGY_BLURB).toContain("Value received by asset (bank credits, range total)");
    expect(METHODOLOGY_BLURB).toContain("four questions");
    expect(METHODOLOGY_BLURB).toContain("day-priced");
    expect(METHODOLOGY_BLURB).toMatch(/not additive|non-additive/i);
  });

  it("records the Value Flow Map removal and the single prior-window comparison rule", () => {
    expect(METHODOLOGY_BLURB).toContain("Removed in the four-questions redesign");
    expect(METHODOLOGY_BLURB).toContain("prior-window rule is now the only one");
    expect(METHODOLOGY_BLURB).not.toMatch(/Gross composition/);
    expect(METHODOLOGY_BLURB).not.toMatch(/checkbox/i);
  });

  it("documents the four question sections, their detail drawers, and the hour fallback", () => {
    for (const q of ["Q1 Is the chain busier?", "Q2 Is usage becoming more organic?", "Q3 Is value flowing in or out?", "Q4 Is the economic base broadening or concentrating?"]) {
      expect(METHODOLOGY_BLURB).toContain(q);
    }
    expect(METHODOLOGY_BLURB).toContain("Detail drawer");
    expect(METHODOLOGY_BLURB).toContain("hourly_metrics");
  });
});
