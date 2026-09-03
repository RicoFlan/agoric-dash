import { describe, expect, it } from "vitest";
import { trailingZScores, type DayValue } from "@/lib/anomalies";

function days(values: (number | null)[], start = "2026-08-01"): DayValue[] {
  const d0 = new Date(`${start}T00:00:00Z`);
  return values.map((value, i) => {
    const d = new Date(d0);
    d.setUTCDate(d.getUTCDate() + i);
    return { day: d.toISOString().slice(0, 10), value };
  });
}

describe("trailingZScores", () => {
  it("scores against the preceding window only and flags a spike", () => {
    const base = Array.from({ length: 10 }, (_, i) => 100 + (i % 2 ? 5 : -5)); // mean 100, sd 5
    const r = trailingZScores(days([...base, 150]), { windowDays: 30, minPoints: 7, threshold: 2.5 });
    const last = r.scored[r.scored.length - 1]!;
    expect(last.z).toBeCloseTo(10, 5);
    expect(r.flagged).toEqual([{ day: last.day, value: 150, z: last.z, direction: "high" }]);
    // the first days have too few prior points to score
    expect(r.scored[0]!.z).toBeNull();
    expect(r.scored[6]!.z).toBeNull();
    expect(r.scored[7]!.z).not.toBeNull();
  });

  it("uses only the trailing windowDays points", () => {
    const early = Array(10).fill(1000); // far outside window
    const recent = Array.from({ length: 8 }, (_, i) => 10 + (i % 2 ? 1 : -1)); // mean 10, sd 1
    const r = trailingZScores(days([...early, ...recent, 20]), { windowDays: 8, minPoints: 7 });
    const last = r.scored[r.scored.length - 1]!;
    expect(last.z).toBeCloseTo(10, 5); // (20 − 10) / 1 — early 1000s ignored
  });

  it("skips nulls as targets and window members, and gives no score on a flat window", () => {
    const r = trailingZScores(days([5, 5, 5, 5, 5, 5, 5, null, 5, 9]), { minPoints: 7 });
    expect(r.scored[7]).toMatchObject({ value: null, z: null });
    expect(r.scored[9]!.z).toBeNull(); // sd 0 → cannot size the step
    expect(r.flagged).toEqual([]);
  });

  it("only flags days at or after flagFromDay, and orders flags by |z|", () => {
    const base = Array.from({ length: 10 }, (_, i) => 100 + (i % 2 ? 5 : -5));
    const series = days([...base, 150, 100, 100, 60]);
    const flagFromDay = series[12]!.day;
    const r = trailingZScores(series, { flagFromDay });
    expect(r.flagged.map((f) => f.day)).toEqual([series[13]!.day]);
    expect(r.flagged[0]!.direction).toBe("low");
    const all = trailingZScores(series);
    expect(all.flagged.map((f) => f.value)).toEqual([150, 60]);
    // the incomplete current day is never flagged
    expect(trailingZScores(series, { flagBeforeDay: series[13]!.day }).flagged.map((f) => f.value)).toEqual([150]);
  });
});
