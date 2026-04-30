import { atomicToFloat, atomicToHumanString } from "@/lib/amountFormat";
import type { EnrichedDisplay } from "@/lib/metricsDisplayTypes";

/** Recharts / axis: human amount when denom is in the table; else raw (may be huge). */
export function valueToChartNumber(atomic: string, denom: string, display?: EnrichedDisplay): number {
  const m = display?.metas[denom];
  if (m) return atomicToFloat(atomic, m.decimals);
  return Number(atomic);
}

export function listRow(atomic: string, denom: string, display: EnrichedDisplay) {
  const m = display.metas[denom] ?? null;
  if (m) {
    const h = atomicToHumanString(atomic, m.decimals);
    return { amountHuman: h, symbol: m.displaySymbol, rawDenom: denom };
  }
  return { amountHuman: atomic, symbol: "", rawDenom: denom };
}

export function formatHumanAxisLabel(symbol: string): string {
  return `Amount (${symbol})`;
}
