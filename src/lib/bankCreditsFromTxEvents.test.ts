import { describe, expect, it } from "vitest";
import { sumBankCreditsByDenom } from "./bankCreditsFromTxEvents";

const neverModule = (): boolean => false;
const alwaysModule = (): boolean => true;

describe("sumBankCreditsByDenom", () => {
  it("sums a coin_received event to a user address per denom", () => {
    const m = sumBankCreditsByDenom(
      [
        {
          type: "coin_received",
          attributes: [
            { key: "receiver", value: "agoric1user" },
            { key: "amount", value: "1000ubld" },
          ],
        },
      ],
      neverModule
    );
    expect(m.get("ubld")).toBe(BigInt(1000));
    expect(m.size).toBe(1);
  });

  it("excludes coin_received events whose receiver is a module account", () => {
    const m = sumBankCreditsByDenom(
      [
        {
          type: "coin_received",
          attributes: [
            { key: "receiver", value: "agoric1mod" },
            { key: "amount", value: "500ubld" },
          ],
        },
        {
          type: "coin_received",
          attributes: [
            { key: "receiver", value: "agoric1user" },
            { key: "amount", value: "200ubld" },
          ],
        },
      ],
      (addr) => addr === "agoric1mod"
    );
    expect(m.get("ubld")).toBe(BigInt(200));
  });

  it("ignores transfer and coin_spent events entirely", () => {
    const m = sumBankCreditsByDenom(
      [
        {
          type: "transfer",
          attributes: [
            { key: "recipient", value: "agoric1user" },
            { key: "sender", value: "agoric1src" },
            { key: "amount", value: "9999ubld" },
          ],
        },
        {
          type: "coin_spent",
          attributes: [
            { key: "spender", value: "agoric1user" },
            { key: "amount", value: "7777ubld" },
          ],
        },
      ],
      neverModule
    );
    expect(m.size).toBe(0);
  });

  it("aggregates multiple coin_received events with mixed module/non-module receivers and denoms", () => {
    const isModule = (addr: string) => addr === "agoric1mod";
    const m = sumBankCreditsByDenom(
      [
        {
          type: "coin_received",
          attributes: [
            { key: "receiver", value: "agoric1alice" },
            { key: "amount", value: "100ubld" },
          ],
        },
        {
          type: "coin_received",
          attributes: [
            { key: "receiver", value: "agoric1mod" },
            { key: "amount", value: "9999ubld" },
          ],
        },
        {
          type: "coin_received",
          attributes: [
            { key: "receiver", value: "agoric1alice" },
            { key: "amount", value: "50uist,7ubld" },
          ],
        },
        {
          type: "coin_received",
          attributes: [
            { key: "receiver", value: "agoric1bob" },
            { key: "amount", value: "3uist" },
          ],
        },
      ],
      isModule
    );
    expect(m.get("ubld")).toBe(BigInt(107));
    expect(m.get("uist")).toBe(BigInt(53));
    expect(m.has("9999ubld")).toBe(false);
  });

  it("skips events with missing or empty receiver attribute without throwing", () => {
    const m = sumBankCreditsByDenom(
      [
        {
          type: "coin_received",
          attributes: [{ key: "amount", value: "1ubld" }],
        },
        {
          type: "coin_received",
          attributes: [
            { key: "receiver", value: "" },
            { key: "amount", value: "2ubld" },
          ],
        },
        {
          type: "coin_received",
          attributes: [
            { key: "receiver", value: "agoric1user" },
            { key: "amount", value: "4ubld" },
          ],
        },
      ],
      neverModule
    );
    expect(m.get("ubld")).toBe(BigInt(4));
  });

  it("returns empty when predicate excludes every receiver", () => {
    const m = sumBankCreditsByDenom(
      [
        {
          type: "coin_received",
          attributes: [
            { key: "receiver", value: "agoric1anyone" },
            { key: "amount", value: "1ubld" },
          ],
        },
      ],
      alwaysModule
    );
    expect(m.size).toBe(0);
  });
});
