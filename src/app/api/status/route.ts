import { NextResponse } from "next/server";
import { computeIndexerLag } from "@/lib/indexerLag";
import { getIndexerStatus } from "@/lib/metricsQuery";
import { rpcCallWithFallback } from "@/lib/rpc";
import { defaultRpcUrls, fetchVbankAssetsCached } from "@/lib/vbankAssetFetch";
import { summarizeLocalRegistryDrift, totalDrift } from "@/lib/localDenomRegistries";

export const dynamic = "force-dynamic";

/** Milliseconds to wait for the chain head before giving up and reporting lag as unknown. */
const HEAD_TIMEOUT_MS = 4_000;

type CometStatus = { sync_info?: { latest_block_height?: string; catching_up?: boolean } };

/**
 * Current chain head, or null. A failure here must never fail the route: the indexer's own
 * timestamp still tells the reader whether it is writing, and reporting "chain head unavailable" is
 * more honest than dropping the whole status card.
 */
async function readChainHeight(): Promise<string | null> {
  const urls = [process.env.RPC_URL ?? "https://main-a.rpc.agoric.net", process.env.RPC_URL_FALLBACK ?? ""];
  try {
    const res = await Promise.race([
      rpcCallWithFallback<CometStatus>(urls, "status", {}),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("chain head timeout")), HEAD_TIMEOUT_MS)),
    ]);
    const h = res?.sync_info?.latest_block_height;
    return typeof h === "string" && /^\d+$/.test(h) ? h : null;
  } catch (e) {
    console.warn("[api/status] chain head unavailable:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Drift between the committed denom registries and the chain's own table, or null when the chain
 * could not be asked.
 *
 * Null is not "no drift". A registry whose decimals are wrong misreports every amount for that
 * denom by a power of ten, so silence and a clean bill of health must stay distinguishable — the
 * same reason unindexed days render as null rather than zero.
 *
 * The publication changes only when an asset is registered, so this is cached for an hour; a
 * failed read is cached briefly so a chain outage cannot make every status request wait.
 */
async function readDenomDrift() {
  try {
    const snapshot = await Promise.race([
      fetchVbankAssetsCached(defaultRpcUrls()),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("vbankAsset timeout")), HEAD_TIMEOUT_MS)),
    ]);
    if (!snapshot) return null;
    const registries = summarizeLocalRegistryDrift(snapshot.entries);
    return {
      checkedAt: snapshot.fetchedAt.toISOString(),
      publishedHeight: snapshot.publishedHeight,
      chainEntries: snapshot.entries.length,
      driftCount: totalDrift(registries),
      registries,
    };
  } catch (e) {
    console.warn("[api/status] denom drift unavailable:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function GET() {
  try {
    const [indexer, chainHeight, denomRegistry] = await Promise.all([
      getIndexerStatus(),
      readChainHeight(),
      readDenomDrift(),
    ]);
    return NextResponse.json({
      chainId: "agoric-3",
      ...indexer,
      lag: computeIndexerLag({
        lastIndexedHeight: indexer.lastIndexedHeight,
        chainHeight,
        updatedAt: indexer.updatedAt,
      }),
      denomRegistry,
    });
  } catch (e) {
    console.error("[api/status]", e);
    const generic = "Status could not be loaded. Try again later.";
    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === "production" ? generic : e instanceof Error ? e.message : generic,
      },
      { status: 500 }
    );
  }
}
