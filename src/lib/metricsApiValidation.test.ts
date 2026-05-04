import { describe, expect, it } from "vitest";
import {
  validateMetricsQuery,
  clampMetricsRangeToIndexedHistory,
  MAX_RANGE_DAYS_DAY_OR_WEEK,
  MAX_RANGE_DAYS_HOUR,
} from "@/lib/metricsApiValidation";
import { INDEXED_HISTORY_FROM_DAY } from "@/lib/semantics";

describe("validateMetricsQuery", () => {
  it("accepts same-day range", () => {
    expect(validateMetricsQuery("2026-04-01", "2026-04-01", "day")).toBeNull();
  });

  it("rejects from after to", () => {
    expect(validateMetricsQuery("2026-04-02", "2026-04-01", "day")).toMatch(/before|after/i);
  });

  it("rejects malformed dates", () => {
    expect(validateMetricsQuery("04-01-2026", "2026-04-02", "day")).not.toBeNull();
  });

  it("caps hour span", () => {
    const from = "2026-01-01";
    const to = "2026-04-01";
    expect(validateMetricsQuery(from, to, "hour")).not.toBeNull();
    expect(validateMetricsQuery("2026-03-01", "2026-04-01", "hour")).toBeNull();
  });

  it("documents caps", () => {
    expect(MAX_RANGE_DAYS_HOUR).toBeLessThanOrEqual(MAX_RANGE_DAYS_DAY_OR_WEEK);
  });
});

describe("clampMetricsRangeToIndexedHistory", () => {
  it("leaves ranges that already start on or after indexed day unchanged", () => {
    const r = clampMetricsRangeToIndexedHistory("2026-01-01", "2026-01-15");
    expect(r).toEqual({ from: "2026-01-01", to: "2026-01-15", clamped: false });
  });

  it("raises from to INDEXED_HISTORY_FROM_DAY when from is earlier", () => {
    const r = clampMetricsRangeToIndexedHistory("2025-06-01", "2026-03-01");
    expect(r.from).toBe(INDEXED_HISTORY_FROM_DAY);
    expect(r.to).toBe("2026-03-01");
    expect(r.clamped).toBe(true);
  });

  it("collapses to a single day when the whole selection is before indexed history", () => {
    const r = clampMetricsRangeToIndexedHistory("2025-01-01", "2025-12-31");
    expect(r).toEqual({
      from: INDEXED_HISTORY_FROM_DAY,
      to: INDEXED_HISTORY_FROM_DAY,
      clamped: true,
    });
  });
});
