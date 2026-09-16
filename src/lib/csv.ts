/**
 * Minimal RFC 4180 CSV writer.
 *
 * Quoting is deliberately conservative: a field is quoted whenever it contains a comma, a quote, a
 * newline, or leading/trailing whitespace that a naive reader would drop. Values arrive as strings
 * and are written unchanged, because these exports carry chain amounts up to 78 digits and any trip
 * through a JavaScript number would silently round them.
 */

const NEEDS_QUOTE = /[",\r\n]|^\s|\s$/;

export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (!NEEDS_QUOTE.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

export function csvRow(fields: readonly (string | number | null | undefined)[]): string {
  return fields.map(csvField).join(",");
}

/** Header plus rows, CRLF-terminated as the spec requires, with a trailing newline. */
export function toCsv(header: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return [csvRow(header), ...rows.map(csvRow)].join("\r\n") + "\r\n";
}

/** A filename-safe slug for a download, e.g. agoric-metrics_2026-08-01_2026-08-31_day.csv */
export function exportFilename(from: string, to: string, granularity: string, ext: "csv" | "json"): string {
  const safe = (s: string) => s.replace(/[^0-9A-Za-z-]/g, "");
  return `agoric-metrics_${safe(from)}_${safe(to)}_${safe(granularity)}.${ext}`;
}
