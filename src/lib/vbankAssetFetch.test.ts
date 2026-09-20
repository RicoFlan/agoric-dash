import { afterEach, describe, expect, it, vi } from "vitest";
import { toHex, toBase64 } from "@cosmjs/encoding";
import { QueryDataResponse } from "@agoric/cosmic-proto/vstorage/query.js";

const rpcCallWithFallback = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rpc", () => ({ rpcCallWithFallback }));

const { fetchVbankAssets, fetchVbankAssetsCached, resetVbankAssetCache } = await import("@/lib/vbankAssetFetch");

/** Wrap a StreamCell the way vstorage serves it. */
function reply(cell: unknown, code = 0) {
  const value =
    cell === undefined
      ? undefined
      : toBase64(QueryDataResponse.encode(QueryDataResponse.fromPartial({ value: JSON.stringify(cell) })).finish());
  return { response: { code, value, log: code === 0 ? "" : "boom" } };
}
/** CapData for a plain JSON body, which is what agoricNames publishes for this path. */
const capData = (body: unknown) => JSON.stringify({ body: `#${JSON.stringify(body)}`, slots: [] });

afterEach(() => {
  rpcCallWithFallback.mockReset();
  resetVbankAssetCache();
  vi.restoreAllMocks();
});

describe("fetchVbankAssets", () => {
  it("decodes a published table", async () => {
    rpcCallWithFallback.mockResolvedValue(
      reply({ blockHeight: "20630183", values: [capData([["ubld", { issuerName: "BLD", displayInfo: { decimalPlaces: 6 } }]])] })
    );
    const got = await fetchVbankAssets(["http://rpc"]);
    expect(got).toMatchObject({
      publishedHeight: "20630183",
      entries: [{ denom: "ubld", issuerName: "BLD", decimals: 6 }],
    });
  });

  it("returns null on a nonzero ABCI code, which arrives inside a successful reply", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    rpcCallWithFallback.mockResolvedValue(reply({ values: [capData([])] }, 38));
    expect(await fetchVbankAssets(["http://rpc"])).toBeNull();
  });

  it("returns null when the query throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    rpcCallWithFallback.mockRejectedValue(new Error("connection refused"));
    expect(await fetchVbankAssets(["http://rpc"])).toBeNull();
  });

  it("treats a publication that is not the pair array as unreadable, NOT as an empty table", async () => {
    // The distinction this whole module exists for: [] would reconcile clean and report no drift.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const body of [{ notAnArray: true }, null, "text", 7]) {
      rpcCallWithFallback.mockResolvedValue(reply({ values: [capData(body)] }));
      resetVbankAssetCache();
      expect(await fetchVbankAssets(["http://rpc"])).toBeNull();
    }
  });

  it("treats an all-malformed array as unreadable rather than reporting zero assets", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    rpcCallWithFallback.mockResolvedValue(reply({ values: [capData(["junk", 5, []])] }));
    expect(await fetchVbankAssets(["http://rpc"])).toBeNull();
  });

  it("keeps a genuinely empty published array as an empty table", async () => {
    rpcCallWithFallback.mockResolvedValue(reply({ values: [capData([])] }));
    expect((await fetchVbankAssets(["http://rpc"]))?.entries).toEqual([]);
  });

  it("returns null for an undecodable payload", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    rpcCallWithFallback.mockResolvedValue({ response: { code: 0, value: "!!!not base64!!!" } });
    expect(await fetchVbankAssets(["http://rpc"])).toBeNull();
  });

  it("returns null when the cell carries no values", async () => {
    rpcCallWithFallback.mockResolvedValue(reply({ blockHeight: "1", values: [] }));
    expect(await fetchVbankAssets(["http://rpc"])).toBeNull();
  });
});

describe("fetchVbankAssetsCached", () => {
  it("reads once within the TTL", async () => {
    rpcCallWithFallback.mockResolvedValue(reply({ values: [capData([["ubld", { issuerName: "BLD", displayInfo: { decimalPlaces: 6 } }]])] }));
    await fetchVbankAssetsCached(["http://rpc"]);
    await fetchVbankAssetsCached(["http://rpc"]);
    expect(rpcCallWithFallback).toHaveBeenCalledTimes(1);
  });

  it("retries a failure sooner than it refreshes a success", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    rpcCallWithFallback.mockRejectedValue(new Error("down"));
    expect(await fetchVbankAssetsCached(["http://rpc"], 3_600_000, 0)).toBeNull();
    expect(await fetchVbankAssetsCached(["http://rpc"], 3_600_000, 0)).toBeNull();
    expect(rpcCallWithFallback).toHaveBeenCalledTimes(2);
  });
});
