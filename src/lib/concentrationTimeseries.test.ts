import { describe, expect, it } from "vitest";
import { buildConcentrationOverTime } from "./concentrationTimeseries";

describe("buildConcentrationOverTime", () => {
  it("emits one dense point per UTC day with gaps where no priced addresses", () => {
    const gross = new Map<string, number[]>([
      ["2026-01-01", [100, 100]], // two equal addresses -> HHI 0.5, top-N share 100%
    ]);
    const fees = new Map<string, number[]>([
      ["2026-01-02", [90, 10]], // HHI 0.81 + 0.01 = 0.82
    ]);
    const rows = buildConcentrationOverTime("2026-01-01", "2026-01-03", gross, fees, 10);
    expect(rows.map((r) => r.day)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);

    expect(rows[0]!.grossUsdHhi).toBeCloseTo(0.5, 10);
    expect(rows[0]!.top10ShareGrossUsdPct).toBeCloseTo(100, 10);
    expect(rows[0]!.feesUsdHhi).toBeNull();

    expect(rows[1]!.feesUsdHhi).toBeCloseTo(0.82, 10);
    expect(rows[1]!.grossUsdHhi).toBeNull();

    // Empty day -> all null (chart gap).
    expect(rows[2]).toEqual({
      day: "2026-01-03",
      grossUsdHhi: null,
      feesUsdHhi: null,
      top10ShareGrossUsdPct: null,
      top10ShareFeesUsdPct: null,
    });
  });

  it("returns empty for an invalid day range", () => {
    expect(buildConcentrationOverTime("2026-01-05", "2026-01-01", new Map(), new Map(), 10)).toEqual(
      []
    );
  });
});
