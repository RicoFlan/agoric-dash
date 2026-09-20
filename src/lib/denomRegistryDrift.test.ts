import { describe, expect, it } from "vitest";
import { describeDenomDrift, reconcileDenomRegistry } from "@/lib/denomRegistryDrift";

const local = [
  { match: "ubld", displaySymbol: "BLD", decimals: 6 },
  { match: "uist", displaySymbol: "IST", decimals: 6 },
  { match: "upoc26", displaySymbol: "Poc26", decimals: 6 },
  // A pass-through IBC denom that vbank never registers.
  { match: "ibc/PASSTHROUGH", displaySymbol: "SOMETHING (Elsewhere)", decimals: 6 },
];
const chain = [
  { denom: "ubld", issuerName: "BLD", decimals: 6 },
  { denom: "uist", issuerName: "IST", decimals: 6 },
  { denom: "upoc26", issuerName: "PoC26", decimals: 0 },
];

describe("reconcileDenomRegistry", () => {
  it("reports a decimals disagreement and counts the rest as agreed", () => {
    const r = reconcileDenomRegistry(local, chain);
    expect(r.agreed).toBe(2);
    expect(r.drift).toEqual([
      {
        kind: "decimals-differ",
        denom: "upoc26",
        chainIssuerName: "PoC26",
        chainDecimals: 0,
        localDisplaySymbol: "Poc26",
        localDecimals: 6,
      },
    ]);
  });

  it("does not treat an unregistered local denom as drift", () => {
    // 107 of the 125 committed entries are pass-through denoms; flagging them would be noise.
    expect(reconcileDenomRegistry(local, chain).drift.some((d) => d.denom === "ibc/PASSTHROUGH")).toBe(false);
  });

  it("flags a registered denom we cannot resolve at all", () => {
    const r = reconcileDenomRegistry(local, [...chain, { denom: "unew", issuerName: "NEW", decimals: 6 }]);
    expect(r.drift.map((d) => [d.kind, d.denom])).toEqual([
      ["decimals-differ", "upoc26"],
      ["missing-locally", "unew"],
    ]);
  });

  it("ignores a chain entry that omitted decimals rather than inventing a comparison", () => {
    const r = reconcileDenomRegistry(local, [{ denom: "ubld", issuerName: "BLD", decimals: null }]);
    expect(r.drift).toEqual([]);
    expect(r.agreed).toBe(0);
  });

  it("treats a local 0 and a chain 0 as agreement", () => {
    const r = reconcileDenomRegistry([{ match: "upoc26", displaySymbol: "PoC26", decimals: 0 }], [chain[2]!]);
    expect(r.drift).toEqual([]);
    expect(r.agreed).toBe(1);
  });

  it("never compares display labels, which disagree with issuer names by design", () => {
    const r = reconcileDenomRegistry(
      [{ match: "ibc/X", displaySymbol: "USDC (Axelar)", decimals: 6 }],
      [{ denom: "ibc/X", issuerName: "USDC_axl", decimals: 6 }]
    );
    expect(r.drift).toEqual([]);
    expect(r.agreed).toBe(1);
  });

  it("is clean when both sides agree", () => {
    const r = reconcileDenomRegistry(local, chain.slice(0, 2));
    expect(r).toMatchObject({ chainEntries: 2, localEntries: 4, agreed: 2, drift: [] });
  });

  it("ranks a wrong divisor above a denom we merely cannot name", () => {
    const r = reconcileDenomRegistry(local, [
      { denom: "aaa-missing", issuerName: "A", decimals: 6 },
      { denom: "upoc26", issuerName: "PoC26", decimals: 0 },
    ]);
    expect(r.drift[0]!.kind).toBe("decimals-differ");
  });
});

describe("describeDenomDrift", () => {
  it("states the size of the error, not just that there is one", () => {
    const [d] = reconcileDenomRegistry(local, chain).drift;
    expect(describeDenomDrift(d!)).toBe(
      "upoc26 (Poc26): local decimals 6, chain says 0 — amounts are off by 10^6"
    );
  });

  it("says a missing denom resolves as unknown", () => {
    const r = reconcileDenomRegistry([], [{ denom: "unew", issuerName: "NEW", decimals: 6 }]);
    expect(describeDenomDrift(r.drift[0]!)).toBe(
      "unew (NEW): registered on chain with no local entry — resolves as unknown"
    );
  });
});
