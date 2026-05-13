/**
 * Observability for newly-encountered Cosmos / Agoric message typeUrls during indexing.
 *
 * Pure helpers: the indexer owns the `Set<string>` instance and lifecycle. This module just
 * decides "is this typeUrl new?" and formats a stable log line. Used to surface which message
 * types are driving on-chain activity so event-derived rollups (see `bank_credits_volume` in
 * `src/lib/semantics.ts`) can be validated against the actual mix on chain, including
 * Agoric-specific bridge messages outside `TRANSFER_MSG_TYPES`.
 *
 * No persistence: the set lives in process memory and resets on indexer restart. Adequate for
 * a diagnostic. Volume in steady state is low — one log line per *novel* typeUrl per process run.
 */

export function noteFirstSeenTypeUrl(seen: Set<string>, typeUrl: string): boolean {
  if (seen.has(typeUrl)) return false;
  seen.add(typeUrl);
  return true;
}

export function formatNewTypeUrlLog(typeUrl: string, height: string, txIndex: number): string {
  return `[indexer] new typeUrl observed: ${typeUrl} at height ${height} tx_idx ${txIndex}`;
}
