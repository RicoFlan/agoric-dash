import { describe, expect, it } from "vitest";
import { buildGasUtilizationRows } from "./gasUtilizationSeries";

describe("buildGasUtilizationRows", () => {
  it("computes efficiency and block-space utilization per bucket", () => {
    const rows = buildGasUtilizationRows(
      [{ bucket: "d", value: "50" }],
      [{ bucket: "d", value: "100" }],
      [{ bucket: "d", value: "200" }]
    );
    expect(rows[0]!.gasEfficiencyPct).toBe(50);
    expect(rows[0]!.blockGasUtilizationPct).toBe(25);
  });

  it("returns null when denominators are absent", () => {
    const rows = buildGasUtilizationRows([{ bucket: "d", value: "5" }], [], []);
    expect(rows[0]!.gasEfficiencyPct).toBeNull();
    expect(rows[0]!.blockGasUtilizationPct).toBeNull();
  });
});
