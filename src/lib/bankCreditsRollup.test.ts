import { describe, expect, it } from "vitest";
import { addBankCreditsForTx } from "./bankCreditsRollup";
import { SERIES } from "./semantics";

const ROLLUP_KEY_DELIM = "\0";
const neverModule = () => false;
const onlyMod = (addr: string) => addr === "agoric1mod";

describe("addBankCreditsForTx", () => {
  it("accumulates per-denom credits into daily and hourly maps for a user receiver", () => {
    const daily = new Map<string, bigint>();
    const hourly = new Map<string, bigint>();
    const hour = new Date("2026-05-01T12:00:00.000Z");
    addBankCreditsForTx(
      daily,
      hourly,
      "2026-05-01",
      hour,
      [
        {
          type: "coin_received",
          attributes: [
            { key: "receiver", value: "agoric1user" },
            { key: "amount", value: "1000ubld" },
          ],
        },
        {
          type: "coin_received",
          attributes: [
            { key: "receiver", value: "agoric1user" },
            { key: "amount", value: "50uist" },
          ],
        },
      ],
      neverModule
    );
    const dkBld = ["2026-05-01", SERIES.BANK_CREDITS_VOLUME, "ubld"].join(ROLLUP_KEY_DELIM);
    const hkBld = [hour.toISOString(), SERIES.BANK_CREDITS_VOLUME, "ubld"].join(ROLLUP_KEY_DELIM);
    const dkIst = ["2026-05-01", SERIES.BANK_CREDITS_VOLUME, "uist"].join(ROLLUP_KEY_DELIM);
    expect(daily.get(dkBld)).toBe(BigInt(1000));
    expect(hourly.get(hkBld)).toBe(BigInt(1000));
    expect(daily.get(dkIst)).toBe(BigInt(50));
  });

  it("emits no rows when every receiver is a module account", () => {
    const daily = new Map<string, bigint>();
    const hourly = new Map<string, bigint>();
    const hour = new Date("2026-05-01T00:00:00.000Z");
    addBankCreditsForTx(
      daily,
      hourly,
      "2026-05-01",
      hour,
      [
        {
          type: "coin_received",
          attributes: [
            { key: "receiver", value: "agoric1mod" },
            { key: "amount", value: "999ubld" },
          ],
        },
      ],
      onlyMod
    );
    expect(daily.size).toBe(0);
    expect(hourly.size).toBe(0);
  });

  it("sums cumulatively across calls for the same day/hour/denom", () => {
    const daily = new Map<string, bigint>();
    const hourly = new Map<string, bigint>();
    const hour = new Date("2026-05-01T03:00:00.000Z");
    const events = [
      {
        type: "coin_received",
        attributes: [
          { key: "receiver", value: "agoric1user" },
          { key: "amount", value: "100ubld" },
        ],
      },
    ];
    addBankCreditsForTx(daily, hourly, "2026-05-01", hour, events, neverModule);
    addBankCreditsForTx(daily, hourly, "2026-05-01", hour, events, neverModule);
    const dk = ["2026-05-01", SERIES.BANK_CREDITS_VOLUME, "ubld"].join(ROLLUP_KEY_DELIM);
    const hk = [hour.toISOString(), SERIES.BANK_CREDITS_VOLUME, "ubld"].join(ROLLUP_KEY_DELIM);
    expect(daily.get(dk)).toBe(BigInt(200));
    expect(hourly.get(hk)).toBe(BigInt(200));
  });
});
