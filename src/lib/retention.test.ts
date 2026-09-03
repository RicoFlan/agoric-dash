import { describe, expect, it } from "vitest";
import { buildRetention, retentionShares } from "@/lib/retention";

describe("retention", () => {
  it("turns counts into shares and pairs with the prior window", () => {
    const r = buildRetention(
      { active: 200, retained: 120, newAddresses: 50 },
      { active: 100, retained: 50, newAddresses: 30 }
    );
    expect(r.current).toMatchObject({ retainedSharePct: 60, newSharePct: 25 });
    expect(r.previous).toMatchObject({ retainedSharePct: 50, newSharePct: 30 });
    expect(r.retainedShareDeltaPts).toBe(10);
  });

  it("is null-safe when a window had no active addresses", () => {
    expect(retentionShares({ active: 0, retained: 0, newAddresses: 0 })).toMatchObject({ retainedSharePct: null, newSharePct: null });
    expect(buildRetention({ active: 10, retained: 5, newAddresses: 1 }, { active: 0, retained: 0, newAddresses: 0 }).retainedShareDeltaPts).toBeNull();
  });
});
