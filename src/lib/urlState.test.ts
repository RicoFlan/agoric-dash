import { describe, expect, it } from "vitest";
import { isCalendarDay, parseViewState, serializeViewState } from "@/lib/urlState";

const DEF = { from: "2026-08-17", to: "2026-09-15", granularity: "day" } as const;

describe("parseViewState", () => {
  it("reads a full view and accepts the long granularity key", () => {
    expect(parseViewState("?from=2026-01-02&to=2026-01-09&g=hour", DEF)).toEqual({ from: "2026-01-02", to: "2026-01-09", granularity: "hour" });
    expect(parseViewState("from=2026-01-02&to=2026-01-09&granularity=week", DEF).granularity).toBe("week");
  });

  it("falls back per field, never wholesale", () => {
    expect(parseViewState("?from=2026-01-02&to=garbage&g=decade", DEF)).toEqual({ from: "2026-01-02", to: DEF.to, granularity: "day" });
    expect(parseViewState("", DEF)).toEqual(DEF);
  });

  it("rejects dates that are well-formed but not real days", () => {
    expect(isCalendarDay("2026-02-31")).toBe(false);
    expect(parseViewState("?from=2026-02-31", DEF).from).toBe(DEF.from);
  });

  it("swaps a reversed pair instead of rejecting it", () => {
    expect(parseViewState("?from=2026-03-10&to=2026-03-01", DEF)).toMatchObject({ from: "2026-03-01", to: "2026-03-10" });
  });

  it("clamps both ends to the indexed-history floor", () => {
    expect(parseViewState("?from=2020-01-01&to=2020-06-01", DEF, "2026-01-01")).toMatchObject({ from: "2026-01-01", to: "2026-01-01" });
  });
});

describe("serializeViewState", () => {
  it("omits fields that match the default and round-trips the rest", () => {
    expect(serializeViewState(DEF, DEF)).toBe("");
    const s = { from: "2026-01-02", to: "2026-01-09", granularity: "hour" } as const;
    expect(serializeViewState(s, DEF)).toBe("?from=2026-01-02&to=2026-01-09&g=hour");
    expect(parseViewState(serializeViewState(s, DEF), DEF)).toEqual(s);
  });

  it("carries only the field that changed", () => {
    expect(serializeViewState({ ...DEF, granularity: "week" }, DEF)).toBe("?g=week");
  });
});
