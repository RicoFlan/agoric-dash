import { describe, expect, it } from "vitest";
import { accumulateBundleInstall, BundleInstallAccumulator } from "@/lib/bundleInstallRollup";
import { MSG_INSTALL_BUNDLE } from "@/lib/bundleInstallFees";
import type { EventKV } from "@/lib/cosmos";

const PAYER = "agoric1payer";
const events = (gas: string, total: string): EventKV[] => [
  { type: "tx", attributes: [{ key: "fee", value: gas }, { key: "fee_payer", value: PAYER }] },
  { type: "coin_spent", attributes: [{ key: "spender", value: PAYER }, { key: "amount", value: gas }] },
  { type: "coin_spent", attributes: [{ key: "spender", value: PAYER }, { key: "amount", value: total }] },
];
const base = {
  txHash: "AABB",
  height: BigInt(27278319),
  day: "2026-09-10",
  typeUrls: [MSG_INSTALL_BUNDLE],
  events: events("1169053ubld", "120000000ubld"),
};

describe("accumulateBundleInstall", () => {
  it("records an install with its split fees", () => {
    const acc = new BundleInstallAccumulator();
    expect(accumulateBundleInstall(acc, base)).toBe(true);
    expect(acc.rows.get("AABB")).toEqual({
      txHash: "AABB",
      height: BigInt(27278319),
      day: "2026-09-10",
      installer: PAYER,
      gasFeeUbld: "1169053",
      storageFeeUbld: "120000000",
    });
  });

  it("ignores a tx with no install message", () => {
    const acc = new BundleInstallAccumulator();
    expect(accumulateBundleInstall(acc, { ...base, typeUrls: ["/cosmos.bank.v1beta1.MsgSend"] })).toBe(false);
    expect(acc.size).toBe(0);
  });

  it("records an install that shares a tx with other messages", () => {
    const acc = new BundleInstallAccumulator();
    expect(accumulateBundleInstall(acc, { ...base, typeUrls: ["/cosmos.bank.v1beta1.MsgSend", MSG_INSTALL_BUNDLE] })).toBe(true);
    expect(acc.size).toBe(1);
  });

  it("is idempotent on the tx hash — a replayed block rewrites, never duplicates", () => {
    const acc = new BundleInstallAccumulator();
    accumulateBundleInstall(acc, base);
    accumulateBundleInstall(acc, base);
    accumulateBundleInstall(acc, base);
    expect(acc.size).toBe(1);
    expect(acc.rows.get("AABB")!.storageFeeUbld).toBe("120000000");
  });

  it("keeps distinct transactions apart", () => {
    const acc = new BundleInstallAccumulator();
    accumulateBundleInstall(acc, base);
    accumulateBundleInstall(acc, { ...base, txHash: "CCDD" });
    expect(acc.size).toBe(2);
  });

  it("records zero fees rather than throwing when the events are unusable", () => {
    const acc = new BundleInstallAccumulator();
    expect(accumulateBundleInstall(acc, { ...base, events: [] })).toBe(true);
    expect(acc.rows.get("AABB")).toMatchObject({ installer: null, gasFeeUbld: "0", storageFeeUbld: "0" });
  });

  it("records an install that paid no storage fee", () => {
    const acc = new BundleInstallAccumulator();
    accumulateBundleInstall(acc, {
      ...base,
      events: [
        { type: "tx", attributes: [{ key: "fee", value: "500ubld" }, { key: "fee_payer", value: PAYER }] },
        { type: "coin_spent", attributes: [{ key: "spender", value: PAYER }, { key: "amount", value: "500ubld" }] },
      ],
    });
    expect(acc.rows.get("AABB")).toMatchObject({ gasFeeUbld: "500", storageFeeUbld: "0" });
  });
});
