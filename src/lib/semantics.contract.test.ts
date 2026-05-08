import { describe, expect, it } from "vitest";
import { METRIC_DICTIONARY } from "@/lib/metricDictionary";
import { SERIES, TX_RESULT_ROLLUP_POLICY } from "@/lib/semantics";

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
