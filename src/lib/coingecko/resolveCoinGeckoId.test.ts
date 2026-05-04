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

  it("uses CoinGecko id 'sei' for SEI (not sei-network)", () => {
    expect(resolveCoinGeckoId("ibc/2A041EEB0C09F7F174FCA5679C7325B1B4151310B6407CB48092C52BCC03BE4E")).toBe("sei");
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

  it("returns null when denom is unknown to denoms.json", () => {
    expect(resolveCoinGeckoId("ibc/UNKNOWN00000000000000000000000000000000000000000000000000")).toBeNull();
  });
});
