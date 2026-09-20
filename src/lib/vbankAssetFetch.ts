/**
 * Fetch and cache the chain's vbankAsset table.
 *
 * Shared by the standalone drift check and `/api/status`. The publication changes only when an
 * asset is registered or its issuer replaced — on agoric-3 the last write is months old — so the
 * status route caches it rather than paying a vstorage read per request.
 *
 * A failure here returns null and never throws to the caller. Drift reporting is a secondary
 * signal; losing it must not take down a status page whose primary job is to say whether the
 * indexer is writing.
 */
import { toHex, fromBase64 } from "@cosmjs/encoding";
import { QueryDataRequest, QueryDataResponse } from "@agoric/cosmic-proto/vstorage/query.js";
import { rpcCallWithFallback } from "@/lib/rpc";
import { parseCapData } from "@/lib/walletOfferMarshal";
import { summarizeVbankAssets, VBANK_ASSET_PATH, type ChainDenomEntry } from "@/lib/vbankAssetRegistry";

export interface VbankAssetSnapshot {
  readonly entries: readonly ChainDenomEntry[];
  /** Height the publication was written at, per the StreamCell. Null when it did not say. */
  readonly publishedHeight: string | null;
  readonly fetchedAt: Date;
}

const PATH = VBANK_ASSET_PATH.join(".");

/**
 * Read the table at the current height.
 *
 * As in the provisioning backfill: a nonzero ABCI code arrives inside a successful JSON-RPC reply,
 * so it is checked explicitly. An unanswered query returns null rather than an empty table, since
 * "no assets registered" and "we could not ask" would otherwise look identical — and the first
 * would read as 18 denoms suddenly vanishing from the chain.
 */
export async function fetchVbankAssets(rpcUrls: readonly string[]): Promise<VbankAssetSnapshot | null> {
  const reqBytes = QueryDataRequest.encode(QueryDataRequest.fromPartial({ path: PATH })).finish();
  let res: { response?: { value?: string; code?: number; log?: string } };
  try {
    res = await rpcCallWithFallback(rpcUrls, "abci_query", {
      path: "/agoric.vstorage.Query/Data",
      data: toHex(reqBytes),
      prove: false,
      height: "0",
    });
  } catch (e) {
    console.warn("[vbankAsset] query failed:", e instanceof Error ? e.message : e);
    return null;
  }
  const code = res.response?.code ?? 0;
  if (code !== 0) {
    console.warn(`[vbankAsset] abci code ${code}: ${String(res.response?.log ?? "").slice(0, 200)}`);
    return null;
  }
  if (!res.response?.value) return null;
  try {
    const cell = JSON.parse(QueryDataResponse.decode(fromBase64(res.response.value)).value) as {
      values?: string[];
      blockHeight?: string;
    };
    const last = cell.values?.at(-1);
    if (!last) return null;
    return {
      entries: summarizeVbankAssets(parseCapData(last)),
      publishedHeight: cell.blockHeight ?? null,
      fetchedAt: new Date(),
    };
  } catch (e) {
    console.warn("[vbankAsset] undecodable payload:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Default endpoints, matching the rest of the app's RPC configuration. */
export function defaultRpcUrls(): string[] {
  return [process.env.RPC_URL ?? "https://main-a.rpc.agoric.net", process.env.RPC_URL_FALLBACK ?? ""].filter(
    (u) => u.length > 0
  );
}

let cached: { at: number; snapshot: VbankAssetSnapshot | null } | null = null;

/**
 * Cached read for request paths. A failed fetch is cached too, for a shorter time, so a chain
 * outage cannot turn every page render into another timeout.
 */
export async function fetchVbankAssetsCached(
  rpcUrls: readonly string[],
  ttlMs = 3_600_000,
  failureTtlMs = 60_000
): Promise<VbankAssetSnapshot | null> {
  const now = Date.now();
  if (cached && now - cached.at < (cached.snapshot ? ttlMs : failureTtlMs)) return cached.snapshot;
  const snapshot = await fetchVbankAssets(rpcUrls);
  cached = { at: now, snapshot };
  return snapshot;
}

/** Test seam: drop the cache. */
export function resetVbankAssetCache(): void {
  cached = null;
}
