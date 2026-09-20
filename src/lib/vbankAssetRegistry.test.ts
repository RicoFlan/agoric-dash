import { describe, expect, it } from "vitest";
import { isVbankAssetPath, summarizeVbankAssets } from "@/lib/vbankAssetRegistry";

/** Shape as published on agoric-3, trimmed to the fields this module reads. */
const entry = (denom: string, issuerName: string, decimalPlaces: unknown) => [
  denom,
  { brand: {}, denom, displayInfo: { assetKind: "nat", decimalPlaces }, issuerName, proposedName: issuerName },
];

describe("summarizeVbankAssets", () => {
  it("decodes the published pair array", () => {
    expect(summarizeVbankAssets([entry("ubld", "BLD", 6), entry("upoc26", "PoC26", 0)])).toEqual([
      { denom: "ubld", issuerName: "BLD", decimals: 6 },
      { denom: "upoc26", issuerName: "PoC26", decimals: 0 },
    ]);
  });

  it("keeps decimals 0 as a value rather than falling back", () => {
    // 0 is falsy and PoC26 really is 0 — a `||` here would silently report null and hide drift.
    expect(summarizeVbankAssets([entry("upoc26", "PoC26", 0)])[0]!.decimals).toBe(0);
  });

  it("reports absent or unusable decimals as null, not as a guess", () => {
    const got = summarizeVbankAssets([
      entry("a", "A", undefined),
      entry("b", "B", "not a number"),
      entry("c", "C", -1),
      entry("d", "D", 1.5),
      entry("e", "E", 999),
    ]);
    expect(got.map((g) => g.decimals)).toEqual([null, null, null, null, null]);
  });

  it("accepts decimals published as a digit string", () => {
    expect(summarizeVbankAssets([entry("a", "A", "18")])[0]!.decimals).toBe(18);
  });

  it("skips malformed rows instead of throwing, so one bad entry cannot deny the rest", () => {
    const got = summarizeVbankAssets([
      "not a pair",
      [],
      ["denom-only"],
      [42, { issuerName: "X" }],
      ["", { issuerName: "empty denom" }],
      ["ok", null],
      entry("ubld", "BLD", 6),
    ]);
    expect(got).toEqual([{ denom: "ubld", issuerName: "BLD", decimals: 6 }]);
  });

  it("keeps the first of a duplicated denom rather than letting a later row win silently", () => {
    expect(summarizeVbankAssets([entry("ubld", "BLD", 6), entry("ubld", "EVIL", 0)])).toEqual([
      { denom: "ubld", issuerName: "BLD", decimals: 6 },
    ]);
  });

  it("reports a missing or empty issuerName as null", () => {
    expect(summarizeVbankAssets([["ubld", { displayInfo: { decimalPlaces: 6 } }], ["uist", { issuerName: "" }]])).toEqual([
      { denom: "ubld", issuerName: null, decimals: 6 },
      { denom: "uist", issuerName: null, decimals: null },
    ]);
  });

  it("returns nothing for a non-array publication", () => {
    for (const v of [null, undefined, {}, "x", 5]) expect(summarizeVbankAssets(v)).toEqual([]);
  });
});

describe("isVbankAssetPath", () => {
  it("matches only the exact path", () => {
    expect(isVbankAssetPath(["published", "agoricNames", "vbankAsset"])).toBe(true);
    expect(isVbankAssetPath(["published", "agoricNames", "vbankAsset", "extra"])).toBe(false);
    expect(isVbankAssetPath(["published", "agoricNames"])).toBe(false);
    expect(isVbankAssetPath(["published", "agoricNames", "brand"])).toBe(false);
  });
});
