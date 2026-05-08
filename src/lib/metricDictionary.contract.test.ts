import { describe, expect, it } from "vitest";
import { METRIC_DICTIONARY } from "@/lib/metricDictionary";
import { SERIES } from "@/lib/semantics";

describe("METRIC_DICTIONARY", () => {
  it("defines exactly one entry per SERIES value", () => {
    const seriesValues = new Set(Object.values(SERIES));
    const keysFromDict = METRIC_DICTIONARY.filter((d) => d.seriesKey !== undefined).map((d) => d.seriesKey);

    expect(keysFromDict.length).toBe(seriesValues.size);
    for (const v of seriesValues) {
      expect(keysFromDict.filter((k) => k === v).length).toBe(1);
    }
  });

  it("uses unique ids", () => {
    const ids = METRIC_DICTIONARY.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
