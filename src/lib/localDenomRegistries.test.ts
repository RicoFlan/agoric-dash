import { describe, expect, it } from "vitest";
import { localDenomRegistries, summarizeLocalRegistryDrift, totalDrift } from "@/lib/localDenomRegistries";

describe("localDenomRegistries", () => {
  it("exposes both committed copies, not just the hand-maintained one", () => {
    const got = localDenomRegistries();
    expect(got.map((r) => r.source)).toEqual([
      "src/config/denoms.json",
      "src/config/agoricNames.json (vbankAssets)",
    ]);
    expect(got.every((r) => r.entries.length > 0)).toBe(true);
  });

  it("the two copies agree with each other on every denom they share", () => {
    // They disagreed on upoc26 (0 vs 6) until this was checked; a regression here means one copy
    // was regenerated and the other was not.
    const [hand, generated] = localDenomRegistries();
    const byDenom = new Map(hand!.entries.map((e) => [e.match, e.decimals]));
    const conflicts = generated!.entries
      .filter((e) => byDenom.has(e.match) && byDenom.get(e.match) !== e.decimals)
      .map((e) => `${e.match}: generated ${e.decimals} vs hand-maintained ${byDenom.get(e.match)}`);
    expect(conflicts).toEqual([]);
  });
});

describe("summarizeLocalRegistryDrift", () => {
  const chain = [
    { denom: "ubld", issuerName: "BLD", decimals: 6 },
    { denom: "upoc26", issuerName: "PoC26", decimals: 0 },
  ];

  it("reports one summary per registry and finds no drift against the real committed files", () => {
    const got = summarizeLocalRegistryDrift(chain);
    expect(got).toHaveLength(2);
    expect(totalDrift(got)).toBe(0);
  });

  it("catches a decimals change on the chain, with the size of the error", () => {
    const got = summarizeLocalRegistryDrift([{ denom: "ubld", issuerName: "BLD", decimals: 18 }]);
    expect(totalDrift(got)).toBe(2); // both copies carry ubld
    expect(got[0]!.drift[0]).toContain("off by 10^12");
  });

  it("flags a newly registered denom neither copy knows", () => {
    const got = summarizeLocalRegistryDrift([{ denom: "unobody-knows", issuerName: "NEW", decimals: 6 }]);
    expect(totalDrift(got)).toBe(2);
    expect(got[0]!.drift[0]).toContain("resolves as unknown");
  });

  it("totals zero for an empty chain snapshot, since there is nothing to disagree with", () => {
    expect(totalDrift(summarizeLocalRegistryDrift([]))).toBe(0);
  });
});
