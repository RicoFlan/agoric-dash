import { describe, expect, it } from "vitest";
import { atomicToFloat, atomicToHumanString } from "./amountFormat";

describe("atomicToHumanString", () => {
  it("formats micro units (6 dp)", () => {
    expect(atomicToHumanString("1000000", 6)).toBe("1");
    expect(atomicToHumanString("1500000", 6)).toBe("1.5");
    expect(atomicToHumanString("1", 6)).toBe("0.000001");
  });

  it("returns non-digit strings unchanged", () => {
    expect(atomicToHumanString("abc", 6)).toBe("abc");
  });

  it("handles zero", () => {
    expect(atomicToHumanString("0", 6)).toBe("0");
  });

  it("rejects out-of-range decimals (passthrough atomic digits)", () => {
    expect(atomicToHumanString("1000000", 37)).toBe("1000000");
    expect(atomicToHumanString("1000000", -1)).toBe("1000000");
  });

  it("handles very large integers without precision loss in string form", () => {
    const huge =
      "12345678901234567890123456789012345678901234567890123456789012345678901234567890";
    expect(atomicToHumanString(huge, 0)).toBe(huge);
    const n = BigInt(huge);
    const base = 10n ** 6n;
    const whole = (n / base).toString();
    const fracRaw = (n % base).toString().padStart(6, "0").replace(/0+$/, "");
    const expected = fracRaw.length > 0 ? `${whole}.${fracRaw}` : whole;
    expect(atomicToHumanString(huge, 6)).toBe(expected);
  });
});

describe("atomicToFloat", () => {
  it("converts micro to float", () => {
    expect(atomicToFloat("1000000", 6)).toBe(1);
  });

  it("returns 0 for invalid", () => {
    expect(atomicToFloat("x", 6)).toBe(0);
    expect(atomicToFloat("1000000", 37)).toBe(0);
  });

  it("matches parseFloat(atomicToHumanString) for mapped semantics", () => {
    const atomic = "9000000000000000000000";
    expect(atomicToFloat(atomic, 6)).toBe(parseFloat(atomicToHumanString(atomic, 6)));
  });

  it("avoids naive Number(bigint)/10**k drift on huge aggregates", () => {
    const atomic =
      "12345678901234567890123456789012345678901234567890123456789012345678901234567890";
    const naive = Number(BigInt(atomic)) / 10 ** 6;
    const fixed = atomicToFloat(atomic, 6);
    expect(naive).not.toBe(fixed);
    expect(fixed).toBe(parseFloat(atomicToHumanString(atomic, 6)));
  });
});
