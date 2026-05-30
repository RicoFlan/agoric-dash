import { describe, expect, it } from "vitest";
import { alignBucketSeries } from "./bucketSeriesAlign";

describe("alignBucketSeries", () => {
  it("unions and sorts buckets, filling missing with 0", () => {
    const rows = alignBucketSeries({
      a: [
        { bucket: "2026-01-02", value: "5" },
        { bucket: "2026-01-01", value: "1" },
      ],
      b: [{ bucket: "2026-01-02", value: "9" }],
    });
    expect(rows.map((r) => r.bucket)).toEqual(["2026-01-01", "2026-01-02"]);
    expect(rows[0]!.values).toEqual({ a: BigInt(1), b: BigInt(0) });
    expect(rows[1]!.values).toEqual({ a: BigInt(5), b: BigInt(9) });
  });

  it("handles empty input and malformed values", () => {
    expect(alignBucketSeries({})).toEqual([]);
    const rows = alignBucketSeries({ a: [{ bucket: "d", value: "not-a-number" }] });
    expect(rows[0]!.values.a).toBe(BigInt(0));
  });
});
