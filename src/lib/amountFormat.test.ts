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
});

describe("atomicToFloat", () => {
  it("converts micro to float", () => {
    expect(atomicToFloat("1000000", 6)).toBe(1);
  });

  it("returns 0 for invalid", () => {
    expect(atomicToFloat("x", 6)).toBe(0);
  });
});
