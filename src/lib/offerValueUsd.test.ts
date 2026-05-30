import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the CoinGecko spot fetch so the test is deterministic and offline.
const getUsdSpotPrices = vi.fn();
vi.mock("@/lib/coingecko/simplePrice", () => ({
  getUsdSpotPrices: (ids: string[]) => getUsdSpotPrices(ids),
}));

import { enrichOfferValueUsd } from "@/lib/offerValueUsd";
import type { EnrichedDisplay } from "@/lib/metricsDisplayTypes";

const display: EnrichedDisplay = {
  metas: {
    uist: { displaySymbol: "IST", decimals: 6 },
    // USDC (Noble) ibc hash → CoinGecko usd-coin via denoms.json
    "ibc/FE98AAD68F02F03565E9FA39A5E627946699B2B07115889ED812D8BA639576A9": {
      displaySymbol: "USDC (Noble)",
      decimals: 6,
    },
    ubld: { displaySymbol: "BLD", decimals: 6 },
  },
};

const USDC = "ibc/FE98AAD68F02F03565E9FA39A5E627946699B2B07115889ED812D8BA639576A9";

describe("enrichOfferValueUsd", () => {
  beforeEach(() => {
    getUsdSpotPrices.mockReset();
  });

  it("prices give/want/payouts per denom and totals priced rows", async () => {
    getUsdSpotPrices.mockResolvedValue({
      usdByCoinId: { "inter-stable-token": 1, "usd-coin": 1 },
      fetchedAtIso: "2026-05-29T00:00:00.000Z",
      partialOrStale: false,
    });

    const r = await enrichOfferValueUsd(
      { uist: "100000000" }, // 100 IST give
      { [USDC]: "50000000" }, // 50 USDC want
      { uist: "100000000", [USDC]: "50000000" }, // payouts
      display
    );

    expect(r.give.byDenom.uist).toMatch(/\$100\.00/);
    expect(r.give.total).toMatch(/\$100\.00/);
    expect(r.want.byDenom[USDC]).toMatch(/\$50\.00/);
    expect(r.payouts.total).toMatch(/\$150\.00/);
    expect(r.usdPricingMeta).toEqual({
      source: "coingecko",
      spotFetchedAt: "2026-05-29T00:00:00.000Z",
      partialOrStale: false,
    });
  });

  it("returns null cells for denoms without a price or without decimals", async () => {
    getUsdSpotPrices.mockResolvedValue({
      usdByCoinId: {}, // no prices returned
      fetchedAtIso: null,
      partialOrStale: true,
    });

    const r = await enrichOfferValueUsd({ uist: "100000000" }, {}, {}, display);
    expect(r.give.byDenom.uist).toBeNull();
    expect(r.give.total).toBeNull();
    expect(r.usdPricingMeta.partialOrStale).toBe(true);
  });

  it("marks pricing partial/stale when the spot fetch throws", async () => {
    getUsdSpotPrices.mockRejectedValue(new Error("network"));
    const r = await enrichOfferValueUsd({ uist: "1" }, {}, {}, display);
    expect(r.usdPricingMeta.partialOrStale).toBe(true);
    expect(r.give.total).toBeNull();
  });
});
