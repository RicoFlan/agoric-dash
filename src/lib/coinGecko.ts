const BASE_PUBLIC = "https://api.coingecko.com/api/v3";
const BASE_PRO = "https://pro-api.coingecko.com/api/v3";

type PriceMap = Record<string, { usd: number }>;

function getBaseAndHeaders(): { base: string; headers: Record<string, string> } {
  const key = process.env.COINGECKO_API_KEY?.trim();
  if (key) {
    return {
      base: BASE_PRO,
      headers: { "x-cg-pro-api-key": key },
    };
  }
  return { base: BASE_PUBLIC, headers: {} };
}

export async function fetchCoingeckoUsdByIds(
  coingeckoIds: string[]
): Promise<Record<string, number>> {
  const idSet = new Set(coingeckoIds.map((i) => i.trim()).filter(Boolean));
  const ids = [...idSet];
  if (ids.length === 0) return {};

  const { base, headers } = getBaseAndHeaders();
  const url = new URL("/simple/price", base);
  url.searchParams.set("ids", ids.join(","));
  url.searchParams.set("vs_currencies", "usd");
  url.searchParams.set("precision", "full");

  const res = await fetch(url, {
    headers: { accept: "application/json", ...headers },
    next: { revalidate: 120 },
  });
  if (!res.ok) {
    console.warn(`CoinGecko ${res.status} ${res.statusText}`);
    return {};
  }
  const j = (await res.json()) as PriceMap;
  const o: Record<string, number> = {};
  for (const id of ids) {
    const p = j[id];
    if (p?.usd != null && !Number.isNaN(p.usd)) o[id] = p.usd;
  }
  return o;
}
