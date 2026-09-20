import { describe, expect, it } from "vitest";
import { coverageCutoffDay } from "@/lib/backfillCoverageCutoff";

const days = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"];
const cutoff = (unanswered: string[]) =>
  coverageCutoffDay(days, (d) => (unanswered.includes(d) ? "unanswered" : "answered"));

describe("coverageCutoffDay", () => {
  it("returns null when every day was answered", () => {
    expect(cutoff([])).toBeNull();
  });

  it("ignores unanswered days before coverage begins — those are not holes, coverage just starts later", () => {
    expect(cutoff(["2026-01-01", "2026-01-02"])).toBeNull();
  });

  it("stops at the first unanswered day inside the answered span", () => {
    expect(cutoff(["2026-01-03"])).toBe("2026-01-03");
  });

  it("stops at the FIRST hole, not the last, so nothing after it is certified", () => {
    expect(cutoff(["2026-01-02", "2026-01-04"])).toBe("2026-01-02");
  });

  it("distinguishes a leading run from a hole that follows it", () => {
    expect(cutoff(["2026-01-01", "2026-01-03"])).toBe("2026-01-03");
  });

  it("returns null when nothing was answered at all, leaving the checkpoint untouched", () => {
    expect(cutoff(days)).toBeNull();
  });
});
