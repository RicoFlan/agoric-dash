import { describe, expect, it } from "vitest";
import {
  validateMetricsQuery,
  MAX_RANGE_DAYS_DAY_OR_WEEK,
  MAX_RANGE_DAYS_HOUR,
} from "@/lib/metricsApiValidation";

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
