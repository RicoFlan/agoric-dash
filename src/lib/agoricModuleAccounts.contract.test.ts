import { describe, expect, it } from "vitest";
import data from "@/config/agoricModuleAccounts.json";
import {
  AGORIC_MODULE_ACCOUNTS,
  AGORIC_MODULE_ACCOUNT_ADDRESSES,
  isAgoricModuleAccount,
} from "@/lib/agoricModuleAccounts";

const BECH32_PREFIX = "agoric1";

describe("agoricModuleAccounts.json contract", () => {
  it("has the expected top-level shape", () => {
    expect(typeof data.$comment).toBe("string");
    expect(data.$comment.length).toBeGreaterThan(20);
    expect(data.chainId).toBe("agoric-3");
    expect(typeof data.fetchedAt).toBe("string");
    expect(Number.isFinite(Date.parse(data.fetchedAt))).toBe(true);
    expect(Array.isArray(data.entries)).toBe(true);
    expect(data.entries.length).toBeGreaterThan(0);
  });

  it("each entry has agoric1-prefixed bech32 address and module name", () => {
    for (const e of data.entries) {
      expect(typeof e.address).toBe("string");
      expect(e.address.startsWith(BECH32_PREFIX)).toBe(true);
      // Standard bech32 module-account length on agoric-3 is 45 chars; allow
      // a small window for any future curve / format changes without rewriting
      // the test on every upgrade.
      expect(e.address.length).toBeGreaterThanOrEqual(39);
      expect(e.address.length).toBeLessThanOrEqual(90);
      expect(typeof e.name).toBe("string");
      expect(e.name.length).toBeGreaterThan(0);
    }
  });

  it("addresses are unique", () => {
    const addrs = data.entries.map((e) => e.address);
    expect(new Set(addrs).size).toBe(addrs.length);
  });

  it("entries are sorted alphabetically by address (stable diffs)", () => {
    for (let i = 1; i < data.entries.length; i++) {
      const a = data.entries[i - 1].address;
      const b = data.entries[i].address;
      expect(a.localeCompare(b)).toBeLessThanOrEqual(0);
    }
  });
});

describe("agoricModuleAccounts loader", () => {
  it("exposes the same set as the file", () => {
    expect(AGORIC_MODULE_ACCOUNTS.length).toBe(data.entries.length);
    expect(AGORIC_MODULE_ACCOUNT_ADDRESSES.size).toBe(data.entries.length);
    for (const e of data.entries) {
      expect(AGORIC_MODULE_ACCOUNT_ADDRESSES.has(e.address)).toBe(true);
    }
  });

  it("isAgoricModuleAccount returns true for known and false for unknown", () => {
    const known = data.entries[0]!.address;
    expect(isAgoricModuleAccount(known)).toBe(true);
    expect(isAgoricModuleAccount("agoric1notamoduleaccount000000000000000000")).toBe(false);
    expect(isAgoricModuleAccount("")).toBe(false);
    expect(isAgoricModuleAccount("cosmos1foo")).toBe(false);
  });
});
