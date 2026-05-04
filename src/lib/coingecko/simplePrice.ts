/** Client-side in-memory cache survives across warm server invocations in dev; resets on cold start. */
const TTL_MS = 10 * 60 * 1000;

type CacheEntry = { usd: number; fetchedAt: number };

const priceCache = new Map<string, CacheEntry>();

const CHUNK_SIZE = 75;

export type SpotUsdResult = {
  usdByCoinId: Record<string, number>;
  /** Latest fetch time among IDs satisfied by this call (for disclaimers). */
  fetchedAtIso: string | null;
  /** True when CoinGecko returned 429 or a chunk failed — some rows may be missing despite a mapping. */
  partialOrStale: boolean;
};

function coingeckoHeaders(): HeadersInit {
  const h: Record<string, string> = { Accept: "application/json" };
  const key = process.env.COINGECKO_API_KEY;
  if (key) {
    h["x-cg-demo-api-key"] = key;
  }
  return h;
}

/**
 * Latest CoinGecko USD spot per coin id, with TTL cache and batched requests (free-tier friendly).
 */
export async function getUsdSpotPrices(coingeckoIds: string[]): Promise<SpotUsdResult> {
  const now = Date.now();
  const unique = [...new Set(coingeckoIds.filter((id) => typeof id === "string" && id.length > 0))];
  const usdByCoinId: Record<string, number> = {};
  const needFetch: string[] = [];

  for (const id of unique) {
    const hit = priceCache.get(id);
    if (hit && now - hit.fetchedAt < TTL_MS) {
      usdByCoinId[id] = hit.usd;
    } else {
      needFetch.push(id);
    }
  }

  if (needFetch.length === 0) {
    const times = unique.map((id) => priceCache.get(id)?.fetchedAt).filter((t): t is number => typeof t === "number");
    const latest = times.length ? Math.max(...times) : now;
    return {
      usdByCoinId,
      fetchedAtIso: new Date(latest).toISOString(),
      partialOrStale: false,
    };
  }

  let partialOrStale = false;

  for (let i = 0; i < needFetch.length; i += CHUNK_SIZE) {
    const chunk = needFetch.slice(i, i + CHUNK_SIZE);
    const url = new URL("https://api.coingecko.com/api/v3/simple/price");
    url.searchParams.set("vs_currencies", "usd");
    url.searchParams.set("ids", chunk.join(","));

    const res = await fetch(url.toString(), { headers: coingeckoHeaders(), cache: "no-store" });

    if (res.status === 429) {
      partialOrStale = true;
      for (const id of chunk) {
        const stale = priceCache.get(id);
        if (stale) usdByCoinId[id] = stale.usd;
      }
      continue;
    }

    if (!res.ok) {
      partialOrStale = true;
      continue;
    }

    let data: Record<string, { usd?: number } | undefined>;
    try {
      data = (await res.json()) as Record<string, { usd?: number } | undefined>;
    } catch {
      partialOrStale = true;
      continue;
    }

    for (const id of chunk) {
      const u = data[id]?.usd;
      if (typeof u === "number" && Number.isFinite(u)) {
        priceCache.set(id, { usd: u, fetchedAt: now });
        usdByCoinId[id] = u;
      }
    }
  }

  return {
    usdByCoinId,
    fetchedAtIso: Object.keys(usdByCoinId).length > 0 ? new Date().toISOString() : null,
    partialOrStale,
  };
}
