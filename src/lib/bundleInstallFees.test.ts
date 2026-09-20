import { describe, expect, it } from "vitest";
import { amountOf, extractBundleInstallCharge, hasBundleInstall, MSG_INSTALL_BUNDLE } from "@/lib/bundleInstallFees";
import type { EventKV } from "@/lib/cosmos";

const ev = (type: string, kv: Record<string, string>): EventKV => ({
  type,
  attributes: Object.entries(kv).map(([key, value]) => ({ key, value })),
});

const PAYER = "agoric1spydhl7cqs9yvw33ewzrqkcj4m4xvgacl7jx74";
const RESERVE = "agoric1ae0lmtzlgrcnla9xjkpaarq5d5dfez63h3nucl";

/** Event sequence as mainnet emits it for a bundle install (height 27278319, trimmed). */
const MAINNET_INSTALL: EventKV[] = [
  ev("coin_spent", { spender: PAYER, amount: "1169053ubld" }),
  ev("coin_received", { receiver: RESERVE, amount: "1169053ubld" }),
  ev("transfer", { recipient: RESERVE, sender: PAYER, amount: "1169053ubld" }),
  ev("message", { sender: PAYER }),
  ev("tx", { fee: "1169053ubld", fee_payer: PAYER }),
  ev("tx", { acc_seq: `${PAYER}/13` }),
  ev("coin_spent", { spender: PAYER, amount: "120000000ubld" }),
  ev("coin_received", { receiver: RESERVE, amount: "120000000ubld" }),
  ev("transfer", { recipient: RESERVE, sender: PAYER, amount: "120000000ubld" }),
  ev("message", { action: MSG_INSTALL_BUNDLE, sender: PAYER, module: "swingset", msg_index: "0" }),
];

describe("extractBundleInstallCharge", () => {
  it("splits the real mainnet event sequence into 1.169053 BLD gas and 120 BLD storage", () => {
    const c = extractBundleInstallCharge(MAINNET_INSTALL);
    expect(c.feePayer).toBe(PAYER);
    expect(amountOf(c.gasFee)).toBe(BigInt(1_169_053));
    expect(amountOf(c.storageFee)).toBe(BigInt(120_000_000));
  });

  it("does not depend on the recipient address", () => {
    // The fees go to vbank/reserve, not fee_collector; a module address moving must not break this.
    const moved = MAINNET_INSTALL.map((e) =>
      e.type === "transfer" || e.type === "coin_received"
        ? ev(e.type, Object.fromEntries(e.attributes.map((a) => [a.key, a.key === "recipient" || a.key === "receiver" ? "agoric1somewhereelse" : a.value])))
        : e
    );
    expect(amountOf(extractBundleInstallCharge(moved).storageFee)).toBe(BigInt(120_000_000));
  });

  it("does not depend on event ordering", () => {
    const reversed = [...MAINNET_INSTALL].reverse();
    expect(amountOf(extractBundleInstallCharge(reversed).storageFee)).toBe(BigInt(120_000_000));
  });

  it("ignores coins spent by anyone other than the fee payer", () => {
    const withStranger = [...MAINNET_INSTALL, ev("coin_spent", { spender: "agoric1stranger", amount: "999000000ubld" })];
    expect(amountOf(extractBundleInstallCharge(withStranger).storageFee)).toBe(BigInt(120_000_000));
  });

  it("reports no storage fee when the payer spent only the gas fee", () => {
    const gasOnly = MAINNET_INSTALL.slice(0, 6);
    const c = extractBundleInstallCharge(gasOnly);
    expect(amountOf(c.gasFee)).toBe(BigInt(1_169_053));
    expect(c.storageFee.size).toBe(0);
  });

  it("clamps a spend smaller than the declared fee to nothing rather than a negative fee", () => {
    const impossible = [ev("tx", { fee: "500ubld", fee_payer: PAYER }), ev("coin_spent", { spender: PAYER, amount: "100ubld" })];
    expect(extractBundleInstallCharge(impossible).storageFee.size).toBe(0);
  });

  it("keeps denoms separate", () => {
    const mixed = [
      ev("tx", { fee: "100ubld", fee_payer: PAYER }),
      ev("coin_spent", { spender: PAYER, amount: "100ubld" }),
      ev("coin_spent", { spender: PAYER, amount: "7000uist" }),
    ];
    const c = extractBundleInstallCharge(mixed);
    expect(amountOf(c.storageFee, "ubld")).toBe(BigInt(0));
    expect(amountOf(c.storageFee, "uist")).toBe(BigInt(7000));
  });

  it("sums repeated spends by the payer", () => {
    const chunked = [
      ev("tx", { fee: "1000ubld", fee_payer: PAYER }),
      ev("coin_spent", { spender: PAYER, amount: "1000ubld" }),
      ev("coin_spent", { spender: PAYER, amount: "40000000ubld" }),
      ev("coin_spent", { spender: PAYER, amount: "40000000ubld" }),
    ];
    expect(amountOf(extractBundleInstallCharge(chunked).storageFee)).toBe(BigInt(80_000_000));
  });

  it("attributes nothing when no fee_payer was published", () => {
    const anonymous = [ev("coin_spent", { spender: PAYER, amount: "120000000ubld" })];
    const c = extractBundleInstallCharge(anonymous);
    expect(c.feePayer).toBeNull();
    expect(c.storageFee.size).toBe(0);
  });

  it("returns empty for a tx with no events at all", () => {
    const c = extractBundleInstallCharge([]);
    expect(c).toMatchObject({ feePayer: null });
    expect(c.gasFee.size + c.storageFee.size).toBe(0);
  });
});

describe("hasBundleInstall", () => {
  it("matches the install message and nothing else", () => {
    expect(hasBundleInstall([MSG_INSTALL_BUNDLE])).toBe(true);
    expect(hasBundleInstall(["/cosmos.bank.v1beta1.MsgSend", MSG_INSTALL_BUNDLE])).toBe(true);
    expect(hasBundleInstall(["/agoric.swingset.MsgDeliverInbound"])).toBe(false);
    expect(hasBundleInstall([])).toBe(false);
  });
});
