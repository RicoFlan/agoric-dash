/**
 * Pure decoding of `published.agoricNames.vbankAsset` — the chain's own denom-to-brand table.
 *
 * **What this path is, and what it is not.** It lists the assets registered with vbank, meaning
 * those Agoric has issued or adopted an issuer for: 18 on agoric-3. It is authoritative for those
 * — the decimals it reports are the ones the chain's own display logic uses. It is NOT a list of
 * every denom that moves on Agoric. IBC denoms that merely pass through are never registered, and
 * `src/config/denoms.json` carries 125 entries for exactly that reason.
 *
 * So this is a RECONCILIATION source, not a replacement (see denomRegistryDrift.ts). Sourcing the
 * local registry from this path would silently drop 107 denoms the dashboard currently resolves.
 *
 * Everything here is chain-controlled input: denom strings, issuer names and decimal places all
 * come from a publication this code does not author. Each entry is shape-checked independently and
 * a malformed one is skipped, so one bad row cannot deny the reconciliation for every other.
 */

/** The single vstorage path this module reads. */
export const VBANK_ASSET_PATH = ["published", "agoricNames", "vbankAsset"] as const;

export interface ChainDenomEntry {
  /** The on-chain minimal denom, e.g. `ubld` or `ibc/FE98…`. */
  readonly denom: string;
  /** The chain's issuer name, e.g. `USDC_axl`. Not a display label — see denoms.json for those. */
  readonly issuerName: string | null;
  /** Decimal places the chain declares. Null when the publication omitted them. */
  readonly decimals: number | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** A decimals value we are willing to act on: a small non-negative integer. */
function decimalsOf(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null;
  return n !== null && Number.isInteger(n) && n >= 0 && n <= 30 ? n : null;
}

/**
 * Decode the vbankAsset publication into one entry per registered denom.
 *
 * The publication is an array of `[denom, info]` pairs. Anything that is not that shape, or whose
 * denom is not a non-empty string, is dropped rather than guessed at.
 */
export function summarizeVbankAssets(decoded: unknown): ChainDenomEntry[] {
  if (!Array.isArray(decoded)) return [];
  const out: ChainDenomEntry[] = [];
  const seen = new Set<string>();
  for (const pair of decoded) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const denom = pair[0];
    if (typeof denom !== "string" || denom.length === 0) continue;
    // A duplicate denom in one publication is contradictory; keep the first and ignore the rest
    // rather than letting the later one silently win.
    if (seen.has(denom)) continue;
    const info = asRecord(pair[1]);
    if (!info) continue;
    seen.add(denom);
    const issuerName = typeof info.issuerName === "string" && info.issuerName.length > 0 ? info.issuerName : null;
    out.push({ denom, issuerName, decimals: decimalsOf(asRecord(info.displayInfo)?.decimalPlaces) });
  }
  return out;
}

/** True when a decoded vstorage path is exactly `published.agoricNames.vbankAsset`. */
export function isVbankAssetPath(path: readonly string[]): boolean {
  return path.length === VBANK_ASSET_PATH.length && VBANK_ASSET_PATH.every((seg, i) => path[i] === seg);
}
