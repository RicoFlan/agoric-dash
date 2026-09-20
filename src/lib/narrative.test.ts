import { describe, expect, it } from "vitest";
import { buildVerdicts, buildWhatChanged, methodologyNotices } from "@/lib/narrative";
import type { QuestionsPayload } from "@/lib/questionsPayload";

const meta = { source: "coingecko" as const, basis: "daily-close" as const, pricedDays: 1, spotFallbackDays: 0, unpricedDays: 0, spotFetchedAt: null, partialOrStale: false };

function fixture(over: Partial<{ q1: Partial<QuestionsPayload["q1"]>; q2: Partial<QuestionsPayload["q2"]>; q3: Partial<QuestionsPayload["q3"]>; q4: Partial<QuestionsPayload["q4"]> }> = {}): QuestionsPayload {
  const base: QuestionsPayload = {
    contextFromDay: "2026-07-01",
    comparisonWindow: { from: "2026-07-02", to: "2026-07-31" },
    priorWindowHasData: true,
    anomalyRule: { windowDays: 30, minPoints: 7, threshold: 2.5 },
    q1: {
      id: "busier",
      headline: { current: 48600, previous: 41200, pctChange: 17.96 },
      daily: [],
      anomalies: [
        { day: "2026-08-14", value: 3000, z: 3.1, direction: "high" },
        { day: "2026-08-16", value: 2900, z: 2.8, direction: "high" },
      ],
      support: { distinctAccountsPerDayAvg: { current: 1, previous: 1, pctChange: 0 }, failureRatePct: { current: 1, previous: 1 }, feePaidBld: { current: 1, previous: 1, pctChange: 0 } },
    },
    q2: {
      id: "organic",
      headline: { current: 22.0, previous: 21.9, deltaPts: 0.1 },
      counts: {
        current: { interactive: 220, automated: 780, other: 0, total: 1000, interactiveByCategory: [{ category: "ymax", count: 183 }, { category: "psm", count: 37 }] },
        previous: { interactive: 241, automated: 859, other: 0, total: 1100, interactiveByCategory: [] },
      },
      daily: [],
      dailyCounts: [],
      anomalies: [],
      support: { distinctInteractiveWallets: { current: 1, previous: 1, pctChange: 0 }, distinctAutomatedWallets: { current: 1, previous: 1, pctChange: 0 }, walletWeightedPct: { current: 50, previous: 50, deltaPts: 0 }, mixedWallets: 0, categorizedWallets: 2, unclassifiedSharePct: 0, available: true, satisfactionByCategory: [] },
    },
    q3: {
      id: "value-flow",
      headline: { netUsd: -1_200_000, previousNetUsd: 800_000, deltaUsd: -2_000_000, inUsd: 1e6, outUsd: 2.2e6, outOrchUsd: null, activeAssets: 1, pricedAssets: 1, unpricedAssets: []  },
      byAsset: [{ denom: "ibc/USDC", in: "1", out: "2", outOrch: "0", net: "-1", inUsd: 1e6, outUsd: 2.2e6, netUsd: -1_200_000 }],
      perBucket: [],
      daily: [],
      anomalies: [],
      usdPricingMeta: meta,
      orchestrated: { available: false, principalUsd: null, byVenue: [], portfoliosActive: 0, portfoliosWithPositions: 0, portfoliosTotal: 0, flowsInRange: [], netDepositsUsd: null, quarantined: { positions: 0, usd: null }, freshness: { staleThresholdBlocks: 250_000, stalePositions: 0, staleUsd: null }, latestHeight: null, oldestHeight: null, usdPricingMeta: meta },
    },
    q4: {
      id: "base",
      provisioning: { available: false, summary: { newWallets: null, mintedUbld: null, daysOffFee: 0, daysRateChecked: 0, closingWalletsProvisioned: null, closingTotalMintedProvided: null }, daily: [] },
      headline: { current: 14.2, previous: 12.9, pctChange: 10.08 },
      effectiveNGross: 9,
      retention: {
        current: { active: 100, retained: 41, newAddresses: 30, retainedSharePct: 41, newSharePct: 30 },
        previous: { active: 90, retained: 40, newAddresses: 20, retainedSharePct: 44.4, newSharePct: 22.2 },
        retainedShareDeltaPts: -3.4,
      },
      support: { top10FeeSharePct: 70, multiDayInRange: 10 },
      daily: [],
      anomalies: [],
      usdPricingMeta: meta,
    },
  };
  return { ...base, q1: { ...base.q1, ...over.q1 }, q2: { ...base.q2, ...over.q2 }, q3: { ...base.q3, ...over.q3 }, q4: { ...base.q4, ...over.q4 } };
}

describe("buildWhatChanged", () => {
  it("writes one sentence per question, ranks by anomaly z then |Δ%|, and caps at max", () => {
    const s = buildWhatChanged(fixture(), { symbolOf: (d) => (d === "ibc/USDC" ? "USDC (Noble)" : d) });
    expect(s.map((x) => x.id)).toEqual(["busier", "value-flow", "base"]);
    expect(s[0]!.text).toBe("Successful txs rose 18.0% vs the prior 30 days (41,200 → 48,600), with 2 unusual days between 08/14 and 08/16.");
    expect(s[1]!.text).toBe("Net IBC flow turned negative: −$1.20M vs +$800.0k in the prior 30 days, led by USDC (Noble) outflows of $1.20M.");
    // Wording stays inside what fee data can support: breadth of FUNDING, not size of the user base.
    expect(s[2]!.text).toBe("The effective number of fee payers rose 10.1% to 14.2 (wider fee funding); 41% of active addresses were also active in the prior 30 days.");
    expect(buildWhatChanged(fixture(), { max: 4 })[3]!.text).toBe("User-initiated share held at 22.0% while total wallet actions fell 9.1% to 1,000.");
  });

  it("uses 'held' wording for flat changes and 'narrowed/widened' for same-sign flows", () => {
    const s = buildWhatChanged(
      fixture({
        q1: { headline: { current: 100, previous: 100, pctChange: 0 }, anomalies: [] },
        q3: { headline: { netUsd: 500_000, previousNetUsd: 900_000, deltaUsd: -400_000, inUsd: 1, outUsd: 1, outOrchUsd: null, activeAssets: 1, pricedAssets: 1, unpricedAssets: []  }, byAsset: [] },
      }),
      { max: 4 }
    );
    expect(s.find((x) => x.id === "busier")!.text).toBe("Successful txs held at 100 vs the prior 30 days.");
    expect(s.find((x) => x.id === "value-flow")!.text).toBe("Net inflow narrowed to +$500.0k (+$900.0k in the prior 30 days).");
  });

  it("ranks Q2 by the relative change of the ratio, not by percentage points", () => {
    // 2% → 4% is +2 pts but +100% relative; it must outrank a 12%-ish move elsewhere when no anomalies are flagged.
    const s = buildWhatChanged(
      fixture({
        q1: { headline: { current: 112, previous: 100, pctChange: 12 }, anomalies: [] },
        q2: { headline: { current: 4, previous: 2, deltaPts: 2 } },
        q3: { headline: { netUsd: null, previousNetUsd: null, deltaUsd: null, inUsd: null, outUsd: null, outOrchUsd: null, activeAssets: 1, pricedAssets: 1, unpricedAssets: []  }, byAsset: [] },
        q4: { headline: { current: 10, previous: 10, pctChange: 0 } },
      }),
      { max: 4 }
    );
    expect(s.map((x) => x.id)).toEqual(["organic", "busier", "base"]);
    expect(s[0]!.absDeltaPct).toBe(100);
  });

  it("omits questions with no data instead of writing about nothing", () => {
    const s = buildWhatChanged(
      fixture({
        q1: { headline: { current: 0, previous: 0, pctChange: 0 }, anomalies: [] },
        q2: { headline: { current: null, previous: null, deltaPts: null } },
        q3: { headline: { netUsd: null, previousNetUsd: null, deltaUsd: null, inUsd: null, outUsd: null, outOrchUsd: null, activeAssets: 1, pricedAssets: 1, unpricedAssets: []  }, byAsset: [] },
      }),
      { max: 4 }
    );
    expect(s.map((x) => x.id)).toEqual(["base"]);
  });
});

describe("methodologyNotices", () => {
  it("names a counting-rule change that falls inside the range", () => {
    const notices = methodologyNotices("2026-09-01", "2026-09-30");
    expect(notices.length).toBeGreaterThanOrEqual(1);
    expect(notices.join(" ")).toContain("offer_category");
    expect(notices.join(" ")).toMatch(/definitional, not behavioural/);
  });

  it("says nothing for a range with no rule change", () => {
    expect(methodologyNotices("2026-07-01", "2026-07-31")).toEqual([]);
  });
});

describe("buildVerdicts", () => {
  it("answers each question in one sentence and qualifies it", () => {
    const v = buildVerdicts(fixture());
    expect(v.map((x) => x.id)).toEqual(["busier", "organic", "value-flow", "base"]);
    expect(v[0]!.answer).toBe("Busier: successful transactions rose 18.0%.");
    expect(v[0]!.qualifier).toContain("2 unusual days");
    // One product dominating user-initiated actions must be stated, not left for the reader to find.
    expect(v[1]!.qualifier).toContain("83% of user-initiated actions came from ymax");
    expect(v[2]!.answer).toBe("Net outflow of $1.20M across priced assets.");
    expect(v[2]!.qualifier).toContain("outbound counts when a transfer starts, not when it settles");
    expect(v[3]!.answer).toBe("Fee funding widened: the equivalent of 14.2 equally-active payers, rose 10.1%.");
    expect(v[3]!.qualifier).toContain("fee grant");
  });

  it("says plainly when there is nothing to answer with", () => {
    const v = buildVerdicts(
      fixture({
        q1: { headline: { current: 0, previous: 0, pctChange: 0 }, anomalies: [] },
        q2: { headline: { current: null, previous: null, deltaPts: null } },
        q3: { headline: { netUsd: null, previousNetUsd: null, deltaUsd: null, inUsd: null, outUsd: null, outOrchUsd: null, activeAssets: 0, pricedAssets: 0, unpricedAssets: [] }, byAsset: [], daily: [] },
      })
    );
    expect(v[0]!.answer).toBe("No indexed transaction activity in this range.");
    // A null ratio means no CATEGORIZED actions; it is not evidence that nothing happened.
    expect(v[1]!.answer).toBe("No categorized wallet actions in this range.");
    expect(v[2]!.answer).toBe("No priced IBC transfer traffic in this range.");
  });

  it("names an unpriced-asset exclusion in the value-flow qualifier", () => {
    const v = buildVerdicts(
      fixture({ q3: { headline: { netUsd: 100, previousNetUsd: 50, deltaUsd: 50, inUsd: 100, outUsd: 0, outOrchUsd: null, activeAssets: 4, pricedAssets: 3, unpricedAssets: [{ denom: "ibc/X", in: "1", out: "0", net: "1" }] } } })
    );
    expect(v[2]!.qualifier).toContain("1 asset could not be priced");
  });
});
