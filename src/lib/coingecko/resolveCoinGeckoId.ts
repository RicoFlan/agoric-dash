import coingeckoOverrides from "@/config/coingeckoDenomOverrides.json";
import coingeckoSymbol from "@/config/coingeckoDisplaySymbolToId.json";
import { resolveDenom } from "@/lib/resolveDenom";

const OVERRIDES = coingeckoOverrides.overrides as Record<string, string>;
const SYMBOL_TO_ID = coingeckoSymbol.symbolToId as Record<string, string>;

/** Remove a single trailing ` (…)` group (cosmetic chain / bridge tags in denoms.json labels). */
function stripOneTrailingParenGroup(s: string): string {
  return s.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function lookupDisplaySymbol(displaySymbol: string): string | null {
  let s = displaySymbol;
  for (let i = 0; i < 5; i++) {
    const id = SYMBOL_TO_ID[s];
    if (id) return id;
    const next = stripOneTrailingParenGroup(s);
    if (next === s) break;
    s = next;
  }
  return null;
}

/**
 * CoinGecko `/simple/price` coin id for USD spot, when known from config.
 * Unknown denoms → null (caller shows no USD estimate).
 */
export function resolveCoinGeckoId(onChainDenom: string): string | null {
  const o = OVERRIDES[onChainDenom];
  if (o && typeof o === "string" && o.length > 0) return o;

  const meta = resolveDenom(onChainDenom);
  if (!meta) return null;

  return lookupDisplaySymbol(meta.displaySymbol);
}
