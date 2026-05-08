import { describe, expect, it } from "vitest";
import {
  compareHourlyDailyParity,
  utcDayMillisBounds,
  type DailyMetricRow,
  type HourlyMetricRow,
} from "@/lib/metricsRollupParity";

describe("utcDayMillisBounds", () => {
  it("covers full UTC calendar day", () => {
    const { startMs, endMs } = utcDayMillisBounds("2026-04-01");
    expect(new Date(startMs).toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(new Date(endMs).toISOString()).toBe("2026-04-02T00:00:00.000Z");
  });
});

describe("compareHourlyDailyParity", () => {
  const day = "2026-04-01";

  it("reports ok when hourly sums match daily totals per series/dimension", () => {
    const daily: DailyMetricRow[] = [
      { day, series: "tx_success", dimension: "", value: "10" },
      { day, series: "fee_paid", dimension: "ubld", value: "5000" },
    ];
    const hourly: HourlyMetricRow[] = [
      {
        hour: new Date("2026-04-01T03:00:00.000Z"),
        series: "tx_success",
        dimension: "",
        value: "4",
      },
      {
        hour: new Date("2026-04-01T15:00:00.000Z"),
        series: "tx_success",
        dimension: "",
        value: "6",
      },
      {
        hour: new Date("2026-04-01T08:00:00.000Z"),
        series: "fee_paid",
        dimension: "ubld",
        value: "5000",
      },
    ];
    const { ok, mismatches } = compareHourlyDailyParity(daily, hourly, day);
    expect(ok).toBe(true);
    expect(mismatches).toHaveLength(0);
  });

  it("ignores hourly rows outside the UTC day", () => {
    const daily: DailyMetricRow[] = [{ day, series: "gas_used", dimension: "", value: "100" }];
    const hourly: HourlyMetricRow[] = [
      {
        hour: new Date("2026-03-31T23:00:00.000Z"),
        series: "gas_used",
        dimension: "",
        value: "999",
      },
      {
        hour: new Date("2026-04-01T12:00:00.000Z"),
        series: "gas_used",
        dimension: "",
        value: "100",
      },
    ];
    expect(compareHourlyDailyParity(daily, hourly, day).ok).toBe(true);
  });

  it("detects hourly/daily mismatch", () => {
    const daily: DailyMetricRow[] = [{ day, series: "tx_failed", dimension: "", value: "2" }];
    const hourly: HourlyMetricRow[] = [
      {
        hour: new Date("2026-04-01T00:00:00.000Z"),
        series: "tx_failed",
        dimension: "",
        value: "1",
      },
    ];
    const { ok, mismatches } = compareHourlyDailyParity(daily, hourly, day);
    expect(ok).toBe(false);
    expect(mismatches).toEqual([
      {
        series: "tx_failed",
        dimension: "",
        dailyValue: "2",
        hourlySum: "1",
      },
    ]);
  });

  it("treats missing daily row as zero when hourly has no contribution", () => {
    const { ok } = compareHourlyDailyParity([], [], day);
    expect(ok).toBe(true);
  });
});
