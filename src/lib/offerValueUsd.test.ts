import { beforeEach, describe, expect, it, vi } from "vitest";

// Spot is only consulted for ids with a missing day; mock it so tests are deterministic and offline.
const getUsdSpotPrices = vi.fn();
vi.mock("@/lib/coingecko/simplePrice", () => ({
  getUsdSpotPrices: (ids: string[]) => getUsdSpotPrices(ids),
}));

import { DailyPriceTable } from "@/lib/denomPrices";
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
const D1 = "2026-05-28";
const D2 = "2026-05-29";

function table(rows: Record<string, Record<string, number>>) {
  const byId = new Map<string, Map<string, number>>();
  for (const [id, byDay] of Object.entries(rows)) byId.set(id, new Map(Object.entries(byDay)));
  return new DailyPriceTable(byId, D1, D2, D2);
}

const byDay = (entries: Record<string, Record<string, string>>) =>
  new Map(Object.entries(entries).map(([day, m]) => [day, new Map(Object.entries(m).map(([d, v]) => [d, BigInt(v)]))]));

describe("enrichOfferValueUsd", () => {
  beforeEach(() => {
    getUsdSpotPrices.mockClear();
  });

  it("prices give/want/payouts per denom at each day's row and totals priced rows", async () => {
    const t = table({
      "inter-stable-token": { [D1]: 1, [D2]: 1 },
      "usd-coin": { [D1]: 1, [D2]: 2 }, // USDC "moves" so the day basis is visible
    });
    await t.ensureSpot(["inter-stable-token", "usd-coin"]);
    expect(getUsdSpotPrices).not.toHaveBeenCalled();

    const r = enrichOfferValueUsd(
      byDay({ [D1]: { uist: "100000000" } }), // 100 IST give on D1
      byDay({ [D1]: { [USDC]: "25000000" }, [D2]: { [USDC]: "25000000" } }), // 25 + 25 USDC want across two days
      byDay({ [D2]: { uist: "100000000", [USDC]: "50000000" } }), // payouts on D2
      display,
      t
    );

    expect(r.give.byDenom.uist).toMatch(/\$100\.00/);
    expect(r.give.total).toMatch(/\$100\.00/);
    expect(r.want.byDenom[USDC]).toMatch(/\$75\.00/); // 25×$1 + 25×$2
    expect(r.payouts.total).toMatch(/\$200\.00/); // 100×$1 + 50×$2
    expect(r.usdPricingMeta).toMatchObject({
      source: "coingecko",
      basis: "daily-close",
      pricedDays: 5,
      spotFallbackDays: 0,
      unpricedDays: 0,
      spotFetchedAt: null,
      partialOrStale: false,
    });
  });

  it("falls back to spot for a day with no row and reports a mixed basis", async () => {
    getUsdSpotPrices.mockResolvedValue({
      usdByCoinId: { "inter-stable-token": 1 },
      fetchedAtIso: "2026-05-29T00:00:00.000Z",
      partialOrStale: false,
    });
    const t = table({ "inter-stable-token": { [D1]: 1 } }); // D2 missing
    await t.ensureSpot(["inter-stable-token"]);
    const r = enrichOfferValueUsd(byDay({ [D1]: { uist: "1000000" }, [D2]: { uist: "1000000" } }), new Map(), new Map(), display, t);
    expect(r.give.total).toMatch(/\$2\.00/);
    expect(r.usdPricingMeta).toMatchObject({ basis: "mixed", pricedDays: 1, spotFallbackDays: 1, spotFetchedAt: "2026-05-29T00:00:00.000Z" });
  });

  it("returns null cells for denoms without a price and marks partial/stale when spot fails", async () => {
    getUsdSpotPrices.mockResolvedValue({ usdByCoinId: {}, fetchedAtIso: null, partialOrStale: true });
    const t = table({});
    await t.ensureSpot(["inter-stable-token"]);
    const r = enrichOfferValueUsd(byDay({ [D1]: { uist: "100000000" } }), new Map(), new Map(), display, t);
    expect(r.give.byDenom.uist).toBeNull();
    expect(r.give.total).toBeNull();
    expect(r.usdPricingMeta).toMatchObject({ basis: "none", unpricedDays: 1, partialOrStale: true });
  });
});
