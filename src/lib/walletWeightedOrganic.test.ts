import { describe, expect, it } from "vitest";
import type { OfferCategoryParticipantStats } from "@/lib/offersQuery";
import { walletWeightedOrganic } from "@/lib/questionsPayload";

const stats = (o: Partial<OfferCategoryParticipantStats>): OfferCategoryParticipantStats => ({
  distinctInteractiveWallets: 0,
  distinctAutomatedWallets: 0,
  distinctCategorizedWallets: 0,
  distinctMixedWallets: 0,
  byCategory: {},
  available: true,
  ...o,
});

describe("walletWeightedOrganic", () => {
  it("divides interactive wallets by all categorized wallets and reports the point change", () => {
    const r = walletWeightedOrganic(
      stats({ distinctInteractiveWallets: 12, distinctCategorizedWallets: 16 }),
      stats({ distinctInteractiveWallets: 6, distinctCategorizedWallets: 12 })
    );
    expect(r.current).toBe(75);
    expect(r.previous).toBe(50);
    expect(r.deltaPts).toBe(25);
  });

  it("counts a wallet active in both groups once, in the numerator", () => {
    // 3 interactive (one of which also automated), 5 categorized → reach, not a partition.
    const r = walletWeightedOrganic(
      stats({ distinctInteractiveWallets: 3, distinctAutomatedWallets: 3, distinctMixedWallets: 1, distinctCategorizedWallets: 5 }),
      stats({ distinctInteractiveWallets: 3, distinctCategorizedWallets: 5 })
    );
    expect(r.current).toBe(60);
    expect(r.deltaPts).toBe(0);
  });

  it("returns null rather than 0% when no wallet was categorized", () => {
    const r = walletWeightedOrganic(stats({}), stats({ distinctInteractiveWallets: 4, distinctCategorizedWallets: 8 }));
    expect(r).toEqual({ current: null, previous: 50, deltaPts: null });
  });

  it("returns null while the category table is unavailable", () => {
    const r = walletWeightedOrganic(
      stats({ distinctInteractiveWallets: 12, distinctCategorizedWallets: 16, available: false }),
      stats({ distinctInteractiveWallets: 6, distinctCategorizedWallets: 12, available: false })
    );
    expect(r).toEqual({ current: null, previous: null, deltaPts: null });
  });
});
