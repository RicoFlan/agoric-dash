import { atomicToFloat, atomicToHumanString } from "@/lib/amountFormat";
import type { EnrichedDisplay } from "@/lib/metricsDisplayTypes";

export type ListRowOptions = { includeUsd?: boolean };

/** Recharts / axis: human amount when denom is in the table; else raw (may be huge). */
export function valueToChartNumber(atomic: string, denom: string, display?: EnrichedDisplay): number {
  const m = display?.metas[denom];
  if (m) return atomicToFloat(atomic, m.decimals);
  return Number(atomic);
}

export function listRow(
  atomic: string,
  denom: string,
  display: EnrichedDisplay,
  options?: ListRowOptions
) {
  const includeUsd = options?.includeUsd !== false;
  const m = display.metas[denom] ?? null;
  if (m) {
    const h = atomicToHumanString(atomic, m.decimals);
    const u =
      includeUsd &&
      m.coingeckoId &&
      display.usd[m.coingeckoId] != null
        ? (atomicToFloat(atomic, m.decimals) * display.usd[m.coingeckoId]!).toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
            maximumSignificantDigits: 6,
          })
        : null;
    return { amountHuman: h, symbol: m.displaySymbol, usdLine: u, rawDenom: denom };
  }
  return { amountHuman: atomic, symbol: "", usdLine: null, rawDenom: denom };
}

export function formatUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function formatHumanAxisLabel(symbol: string): string {
  return `Amount (${symbol})`;
}
