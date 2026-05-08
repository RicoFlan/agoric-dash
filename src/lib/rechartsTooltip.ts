/** Tooltip payload entries from Recharts (minimal shape). */
export type TooltipPayloadEntry = {
  value?: unknown;
  name?: unknown;
  dataKey?: unknown;
  color?: string;
};

/**
 * Drops series with missing, NaN, or zero values so hover tooltips only show meaningful rows.
 */
export function filterNonZeroTooltipPayload(
  payload: readonly TooltipPayloadEntry[] | undefined
): TooltipPayloadEntry[] {
  if (!payload?.length) return [];
  return payload.filter((e) => {
    const v = e.value;
    if (v === null || v === undefined) return false;
    if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
    const n = Number(v);
    return !Number.isNaN(n) && n !== 0;
  });
}

export function formatTooltipNumber(value: unknown): string {
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "string") return value;
  return String(value ?? "");
}
