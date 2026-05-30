import { describe, expect, it } from "vitest";
import { brandAssetMeta, brandDenom, brandName, instanceName } from "@/lib/agoricInstanceNames";

describe("agoricInstanceNames", () => {
  it("resolves known instance Board ids to names", () => {
    expect(instanceName("board02568")).toBe("psm-IST-USDC_grv");
    expect(instanceName("board00360")).toBe("VaultFactory");
    expect(instanceName("board026384")).toBe("fastUsdc");
  });

  it("resolves known brand Board ids to names", () => {
    expect(brandName("board0257")).toBe("IST");
    expect(brandName("board03138")).toBe("USDC_grv");
  });

  it("resolves vbank Brand board ids to their fungible denom + decimals", () => {
    expect(brandDenom("board0257")).toBe("uist"); // IST
    expect(brandDenom("board0566")).toBe("ubld"); // BLD
    expect(brandAssetMeta("board0257")).toEqual({
      denom: "uist",
      issuerName: "IST",
      decimalPlaces: 6,
    });
  });

  it("returns null for unknown or empty Board ids", () => {
    expect(instanceName("board999999")).toBeNull();
    expect(instanceName(null)).toBeNull();
    expect(brandName(undefined)).toBeNull();
    expect(brandDenom("board999999")).toBeNull();
    expect(brandAssetMeta(null)).toBeNull();
  });
});
