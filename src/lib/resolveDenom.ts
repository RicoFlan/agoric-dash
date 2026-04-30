import denoms from "@/config/denoms.json";

type Entry = { match: string; displaySymbol: string; decimals: number };

export type ResolvedDenom = {
  displaySymbol: string;
  decimals: number;
};

export function resolveDenom(onChainDenom: string): ResolvedDenom | null {
  const entries = denoms.entries as Entry[];
  for (const e of entries) {
    if (e.match === onChainDenom) {
      return {
        displaySymbol: e.displaySymbol,
        decimals: e.decimals,
      };
    }
  }
  return null;
}
