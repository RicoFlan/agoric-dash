/** Maximum fractional digits we support for bigint base `10**decimals` (matches denoms.json contract). */
export const MAX_DENOM_DECIMALS = 36;

/** Min units → human (decimal) string, using bigint-safe division for any size. */
export function atomicToHumanString(atomic: string, decimals: number): string {
  if (!/^\d+$/.test(atomic)) return atomic;
  if (!Number.isFinite(decimals) || decimals < 0 || decimals > MAX_DENOM_DECIMALS) return atomic;
  let n = BigInt(atomic);
  if (n === 0n) return "0";
  const base = 10n ** BigInt(decimals);
  if (n < 0n) n = -n;
  const whole = n / base;
  const frac = n % base;
  if (frac === 0n) return whole.toString();
  const fracPadded = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fracPadded}`;
}

/**
 * Converts minimal units to a JS number for charts and approximate USD math.
 * Uses the same bigint division as {@link atomicToHumanString}, then `parseFloat`.
 * Beyond ~15–17 significant digits, IEEE doubles lose precision; amounts stay aligned
 * with what we render as decimal strings.
 */
export function atomicToFloat(atomic: string, decimals: number): number {
  if (!/^\d+$/.test(atomic)) return 0;
  if (!Number.isFinite(decimals) || decimals < 0 || decimals > MAX_DENOM_DECIMALS) return 0;
  const n = BigInt(atomic);
  if (n === 0n) return 0;
  const humanStr = atomicToHumanString(atomic, decimals);
  if (!/^\d+(\.\d+)?$/.test(humanStr)) return 0;
  const x = Number.parseFloat(humanStr);
  return Number.isFinite(x) ? x : 0;
}
