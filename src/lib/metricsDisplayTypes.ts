export type DenomTableMeta = {
  displaySymbol: string;
  decimals: number;
};

export type EnrichedDisplay = {
  metas: Record<string, DenomTableMeta>;
};
