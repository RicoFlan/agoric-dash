import { describe, expect, it } from "vitest";
import { filledDistinctAccountsPerDay } from "@/lib/filledDistinctAccountsSeries";

describe("filledDistinctAccountsPerDay", () => {
  it("fills gaps with zero between from and to inclusive", () => {
    const rows = filledDistinctAccountsPerDay("2026-01-01", "2026-01-03", [
      { day: "2026-01-01", count: "5" },
      { day: "2026-01-03", count: 2 },
    ]);
    expect(rows).toEqual([
      { bucket: "2026-01-01", distinctAccounts: 5 },
      { bucket: "2026-01-02", distinctAccounts: 0 },
      { bucket: "2026-01-03", distinctAccounts: 2 },
    ]);
  });

  it("returns empty when from > to", () => {
    expect(filledDistinctAccountsPerDay("2026-01-05", "2026-01-01", [])).toEqual([]);
  });
});
