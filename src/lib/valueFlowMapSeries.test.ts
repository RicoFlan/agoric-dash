import { describe, expect, it } from "vitest";
import { buildValueFlowMiniRows } from "@/lib/valueFlowMapSeries";

describe("buildValueFlowMiniRows", () => {
  it("aligns buckets and derives transfer-like as gross minus ibc-in", () => {
    const rows = buildValueFlowMiniRows(
      "uist",
      [
        { bucket: "2026-05-01", value: "100" },
        { bucket: "2026-05-02", value: "300" },
      ],
      [{ bucket: "2026-05-01", value: "40" }],
      [
        { bucket: "2026-05-01", value: "30" },
        { bucket: "2026-05-02", value: "100" },
      ],
      [{ bucket: "2026-05-02", value: "50" }]
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      bucket: "2026-05-01",
      gross: 100,
      ibcIn: 30,
      transferLike: 70,
      credits: 40,
      ibcOut: 0,
    });
    expect(rows[1]).toMatchObject({
      bucket: "2026-05-02",
      gross: 300,
      ibcIn: 100,
      transferLike: 200,
      credits: 0,
      ibcOut: 50,
    });
  });
});
