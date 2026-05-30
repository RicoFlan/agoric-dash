import { describe, expect, it } from "vitest";
import { buildSuccessRateRows } from "./successRateSeries";

describe("buildSuccessRateRows", () => {
  it("computes per-bucket success rate aligned across both series", () => {
    const rows = buildSuccessRateRows(
      [
        { bucket: "2026-01-01", value: "90" },
        { bucket: "2026-01-02", value: "0" },
      ],
      [
        { bucket: "2026-01-01", value: "10" },
        { bucket: "2026-01-02", value: "0" },
      ]
    );
    expect(rows[0]).toEqual({ bucket: "2026-01-01", successful: 90, failed: 10, successRatePct: 90 });
    // No txs in the bucket -> null rate.
    expect(rows[1]!.successRatePct).toBeNull();
  });

  it("fills missing failed buckets as zero (100% success)", () => {
    const rows = buildSuccessRateRows([{ bucket: "d", value: "5" }], []);
    expect(rows[0]).toEqual({ bucket: "d", successful: 5, failed: 0, successRatePct: 100 });
  });
});
