import { describe, expect, it } from "vitest";
import { buildOffersActivityRows } from "@/lib/offersActivitySeries";

describe("buildOffersActivityRows", () => {
  it("folds categories into automation classes per bucket and keeps buckets dense", () => {
    const rows = buildOffersActivityRows([
      {
        category: "orchestration", // automated
        data: [
          { bucket: "2026-05-29", value: "18" },
          { bucket: "2026-05-30", value: "0" },
        ],
      },
      {
        category: "fast_usdc", // automated
        data: [
          { bucket: "2026-05-29", value: "4" },
          { bucket: "2026-05-30", value: "1" },
        ],
      },
      {
        category: "psm", // interactive
        data: [
          { bucket: "2026-05-29", value: "2" },
          { bucket: "2026-05-30", value: "0" },
        ],
      },
      {
        category: "other", // unknown
        data: [
          { bucket: "2026-05-29", value: "3" },
          { bucket: "2026-05-30", value: "0" },
        ],
      },
    ]);

    expect(rows).toEqual([
      { bucket: "2026-05-29", automated: 22, interactive: 2, unknown: 3 },
      { bucket: "2026-05-30", automated: 1, interactive: 0, unknown: 0 },
    ]);
  });

  it("returns empty for no categories", () => {
    expect(buildOffersActivityRows([])).toEqual([]);
  });
});
