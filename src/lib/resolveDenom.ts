import denomsConfig from "@/config/denoms.json";

type Entry = { match: string; displaySymbol: string; decimals: number; coingeckoId?: string };

export type DenomMeta = {
  displaySymbol: string;
  decimals: number;
  coingeckoId: string;
};

const entries: Entry[] = (denomsConfig as { entries: Entry[] }).entries;

/** Resolve chain/IBC denom to display metadata. Unknown denoms = null. */
export function resolveDenom(denom: string): DenomMeta | null {
  for (const e of entries) {
    if (e.match === denom) {
      return {
        displaySymbol: e.displaySymbol,
        decimals: e.decimals,
        coingeckoId: e.coingeckoId ?? "",
      };
    }
  }
  return null;
}
