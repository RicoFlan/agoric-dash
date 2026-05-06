import { describe, expect, it } from "vitest";
import { ensureDenseUtcDayBuckets, iterateUtcDaysInclusive } from "./metricsQuery";

describe("iterateUtcDaysInclusive", () => {
  it("returns inclusive UTC calendar days", () => {
    expect(iterateUtcDaysInclusive("2026-05-01", "2026-05-03")).toEqual([
      "2026-05-01",
      "2026-05-02",
      "2026-05-03",
    ]);
  });

  it("returns a single day when from === to", () => {
    expect(iterateUtcDaysInclusive("2026-05-05", "2026-05-05")).toEqual(["2026-05-05"]);
  });

  it("returns empty when range inverted", () => {
    expect(iterateUtcDaysInclusive("2026-05-05", "2026-05-04")).toEqual([]);
  });
});

describe("ensureDenseUtcDayBuckets", () => {
  it("adds missing day keys with empty series maps", () => {
    const m = new Map<string, Map<string, Map<string, bigint>>>();
    m.set("2026-05-01", new Map());
    ensureDenseUtcDayBuckets(m, "2026-05-01", "2026-05-03");
    expect([...m.keys()].sort()).toEqual(["2026-05-01", "2026-05-02", "2026-05-03"]);
    expect(m.get("2026-05-02")!.size).toBe(0);
  });
});
