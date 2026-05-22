import { describe, expect, it } from "vitest";
import { resolveCoinGeckoId } from "./resolveCoinGeckoId";

describe("resolveCoinGeckoId", () => {
  it("maps native ubld via display symbol", () => {
    expect(resolveCoinGeckoId("ubld")).toBe("agoric");
  });

  it("maps USDC ibc hash via display symbol", () => {
    expect(
      resolveCoinGeckoId("ibc/010704EDB319E4141299BBCB1CD8790362910509330824B88049DE3CE5D0A7AD")
    ).toBe("usd-coin");
  });

  it("maps stTIA (w) IBC path to Stride stTIA", () => {
    expect(resolveCoinGeckoId("ibc/C5FD47DD588011D52ABC4EAB34EA283C20589C81D2B252BB9620DBF7FB1DA8DF")).toBe(
      "stride-staked-tia"
    );
  });

  it("maps SEI IBC path to sei-network", () => {
    expect(resolveCoinGeckoId("ibc/2A041EEB0C09F7F174FCA5679C7325B1B4151310B6407CB48092C52BCC03BE4E")).toBe(
      "sei-network"
    );
  });

  it("maps PICA IBC path to pica", () => {
    expect(resolveCoinGeckoId("ibc/2FAD8D00A958B0A5509A4ECF9E719B65EE268DAFB38FED98FF9B90B720F04C28")).toBe(
      "pica"
    );
  });

  it("uses pSTAKE staked ATOM id for stkATOM (not Stride stATOM)", () => {
    expect(resolveCoinGeckoId("ibc/4721B61DBE668E2F3E613E45885396991F21E8374ABDE48CD7336A77B79101A5")).toBe(
      "pstake-staked-atom"
    );
  });

  it("uses Neutron-3 for NTRN", () => {
    expect(resolveCoinGeckoId("ibc/6EE9687CBBF88E1EFE351BCB01025E0B76452D48A2B41F6583E9E0B942FD62E7")).toBe(
      "neutron-3"
    );
  });

  it("maps AXL (router) aarch IBC path to axelar", () => {
    expect(
      resolveCoinGeckoId("ibc/3763997B746CA5FDC9883C5192B783B114A4610E1A37751955288E0940BB0B7F")
    ).toBe("axelar");
  });

  it("maps Provenance HASH (nhash) IBC path to hash-2", () => {
    expect(
      resolveCoinGeckoId("ibc/00A6285B20010D443BA2DDF0203D29B4FC5E2582D670181BBCAC1583744BA13B")
    ).toBe("hash-2");
  });

  it("returns null when denom is unknown to denoms.json", () => {
    expect(resolveCoinGeckoId("ibc/UNKNOWN00000000000000000000000000000000000000000000000000")).toBeNull();
  });
});
