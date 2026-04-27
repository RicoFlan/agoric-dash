/** Min units → human (decimal) string, using bigint-safe division for any size. */
export function atomicToHumanString(atomic: string, decimals: number): string {
  if (!/^\d+$/.test(atomic)) return atomic;
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

/** For charts / recharts: lossy but ok for normal ranges. */
export function atomicToFloat(atomic: string, decimals: number): number {
  if (!/^\d+$/.test(atomic)) return 0;
  const n = BigInt(atomic);
  if (n === 0n) return 0;
  if (n > 10n ** 24n) {
    return Number(atomic) / 10 ** decimals;
  }
  return Number(n) / 10 ** decimals;
}
