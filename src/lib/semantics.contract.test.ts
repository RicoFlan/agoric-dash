import { describe, expect, it } from "vitest";
import { METRIC_DICTIONARY } from "@/lib/metricDictionary";
import {
  INDEXER_SCOPE_CAVEAT_INLINE,
  INDEXER_SCOPE_CAVEAT_SUBTITLE,
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
