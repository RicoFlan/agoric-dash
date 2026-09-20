import { describe, expect, it } from "vitest";
import { parseCapData } from "@/lib/walletOfferMarshal";
import {
  extractProvisionPoolCapData,
  isProvisionPoolMetricsPath,
  summarizeProvisionPoolMetrics,
} from "@/lib/provisionPoolVstorage";

/**
 * Captured from mainnet 2026-09-20 via
 * `/agoric/vstorage/data/published.provisionPool.metrics` — the two consecutive publications that
 * were live in one StreamCell. They are the evidence that the counters move independently.
 */
const V0 =
  '{"body":"#{\\"totalMintedConverted\\":{\\"brand\\":\\"$0.Alleged: BLD brand\\",\\"value\\":\\"+0\\"},\\"totalMintedProvided\\":{\\"brand\\":\\"$0\\",\\"value\\":\\"+3710000000\\"},\\"walletsProvisioned\\":\\"+1452\\"}","slots":["board0566"]}';
const V1 =
  '{"body":"#{\\"totalMintedConverted\\":{\\"brand\\":\\"$0.Alleged: BLD brand\\",\\"value\\":\\"+0\\"},\\"totalMintedProvided\\":{\\"brand\\":\\"$0\\",\\"value\\":\\"+3710000000\\"},\\"walletsProvisioned\\":\\"+1453\\"}","slots":["board0566"]}';

const summarize = (capData: string) => summarizeProvisionPoolMetrics(parseCapData(capData));

describe("summarizeProvisionPoolMetrics", () => {
  it("decodes a real mainnet publication", () => {
    expect(summarize(V1)).toEqual({
      walletsProvisioned: 1453,
      totalMintedProvided: "3710000000",
      totalMintedConverted: "0",
      brandBoardId: "board0566",
    });
  });

  it("shows the counters moving independently — the reason the fee cross-check fails", () => {
    // Both publications were live in ONE cell: a wallet was provisioned with no minting at all.
    const a = summarize(V0)!;
    const b = summarize(V1)!;
    expect(b.walletsProvisioned! - a.walletsProvisioned!).toBe(1);
    expect(BigInt(b.totalMintedProvided!) - BigInt(a.totalMintedProvided!)).toBe(BigInt(0));
  });

  it("returns null for a field the publication omitted, never 0", () => {
    // 0 provisioned wallets and "this publication did not say" are different facts.
    const partial = summarizeProvisionPoolMetrics({ totalMintedProvided: { brand: null, value: "+5" } });
    expect(partial).toMatchObject({ walletsProvisioned: null, totalMintedProvided: "5" });
  });

  it("rejects a publication with nothing usable in it", () => {
    expect(summarizeProvisionPoolMetrics({})).toBeNull();
    expect(summarizeProvisionPoolMetrics(null)).toBeNull();
    expect(summarizeProvisionPoolMetrics("nope")).toBeNull();
  });

  it("accepts a bare Nat with or without the leading plus", () => {
    expect(summarizeProvisionPoolMetrics({ walletsProvisioned: "+7" })?.walletsProvisioned).toBe(7);
    expect(summarizeProvisionPoolMetrics({ walletsProvisioned: "7" })?.walletsProvisioned).toBe(7);
    expect(summarizeProvisionPoolMetrics({ walletsProvisioned: 7 })?.walletsProvisioned).toBe(7);
    expect(summarizeProvisionPoolMetrics({ walletsProvisioned: "seven" })).toBeNull();
  });
});

describe("isProvisionPoolMetricsPath", () => {
  it("matches only the exact metrics path", () => {
    expect(isProvisionPoolMetricsPath(["published", "provisionPool", "metrics"])).toBe(true);
    expect(isProvisionPoolMetricsPath(["published", "provisionPool", "governance"])).toBe(false);
    expect(isProvisionPoolMetricsPath(["published", "provisionPool"])).toBe(false);
    expect(isProvisionPoolMetricsPath(["published", "provisionPool", "metrics", "extra"])).toBe(false);
    expect(isProvisionPoolMetricsPath(["published", "wallet", "metrics"])).toBe(false);
  });
});

describe("extractProvisionPoolCapData", () => {
  const ev = (key: string, value: string) => ({
    type: "state_change",
    attributes: [
      { key: "store", value: "vstorage" },
      { key: "key", value: key },
      { key: "value", value },
    ],
  });
  // vstorage keys arrive length-prefixed per segment; decodeVstoragePath handles the encoding.
  const KEY = "3\0published\0provisionPool\0metrics";
  const cell = (...vals: string[]) => JSON.stringify({ values: vals });

  it("takes the LAST value in a cell, which is the state as of that block", () => {
    const got = extractProvisionPoolCapData([ev(KEY, cell(V0, V1))]);
    expect(got).toHaveLength(1);
    expect(summarize(got[0]!)?.walletsProvisioned).toBe(1453);
  });

  it("ignores other vstorage paths and non-vstorage stores", () => {
    expect(extractProvisionPoolCapData([ev("3\0published\0provisionPool\0governance", cell(V1))])).toEqual([]);
    expect(
      extractProvisionPoolCapData([
        { type: "state_change", attributes: [{ key: "store", value: "swingset" }, { key: "key", value: KEY }, { key: "value", value: cell(V1) }] },
      ])
    ).toEqual([]);
    expect(extractProvisionPoolCapData([{ type: "transfer", attributes: [] }])).toEqual([]);
  });

  it("survives malformed input rather than throwing mid-block", () => {
    expect(extractProvisionPoolCapData(undefined)).toEqual([]);
    expect(extractProvisionPoolCapData([ev(KEY, "not json")])).toEqual([]);
    expect(extractProvisionPoolCapData([ev(KEY, cell())])).toEqual([]);
  });
});
