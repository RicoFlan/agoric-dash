export type DenomTableMeta = {
  displaySymbol: string;
  decimals: number;
  coingeckoId: string;
};

export type EnrichedDisplay = {
  usd: Record<string, number>;
  metas: Record<string, DenomTableMeta>;
  pricingFromCoinGecko: boolean;
};
