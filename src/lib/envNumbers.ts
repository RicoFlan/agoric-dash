/**
 * Strict numeric env parsing for the backfill scripts.
 *
 * `Math.max(1, Math.min(64, Number(x)))` returns NaN for a non-numeric value, and
 * `Array.from({ length: NaN })` produces an empty array: the job then does no work, persists nothing
 * and still advances its checkpoint, which is unrecoverable for additive series. So an invalid value
 * must stop the process rather than quietly become "no workers".
 */
export function requirePositiveInt(name: string, raw: string | undefined, fallback: number, opts: { min?: number; max?: number } = {}): number {
  const min = opts.min ?? 1;
  const max = opts.max ?? Number.MAX_SAFE_INTEGER;
  if (raw === undefined || raw.trim() === "") return Math.min(max, Math.max(min, fallback));
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}; got ${JSON.stringify(raw)}`);
  }
  return n;
}
