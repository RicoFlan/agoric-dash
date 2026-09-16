import { NextResponse } from "next/server";
import { computeIndexerLag } from "@/lib/indexerLag";
import { getIndexerStatus } from "@/lib/metricsQuery";
import { rpcCallWithFallback } from "@/lib/rpc";

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

export async function GET() {
  try {
    const [indexer, chainHeight] = await Promise.all([getIndexerStatus(), readChainHeight()]);
    return NextResponse.json({
      chainId: "agoric-3",
      ...indexer,
      lag: computeIndexerLag({
        lastIndexedHeight: indexer.lastIndexedHeight,
        chainHeight,
        updatedAt: indexer.updatedAt,
      }),
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
