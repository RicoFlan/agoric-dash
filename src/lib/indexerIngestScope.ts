/**
 * Bounds what `scripts/indexer.ts` pulls from CometBFT RPC each height.
 *
 * **Included:** `GET /block` (header time + tx bytes) and `GET /block_results` **`txs_results`**
 * only — ABCI fields (`code`, `gas_used`) plus module events emitted during **that tx’s** execution.
 *
 * **Narrow finalize-block exception (offer outcomes):** the indexer additionally reads
 * `block_results.finalize_block_events` for **vstorage `state_change` events on
 * `published.wallet.<addr>`** to self-index settled Zoe offer outcomes (`offer_outcome` series) —
 * these `offerStatus` updates settle asynchronously after the offer tx and are not present in any
 * `txs_results` row. No other finalize-block event family is ingested.
 *
 * **Not included:** all other finalize-block / BeginBlock / EndBlock emissions (minting,
 * distribution payouts, slashing records, other vstorage paths, etc.) when not mirrored inside a
 * `txs_results` row. This dashboard’s rollups therefore do not represent full chain economic flows —
 * only activity attributable to included transactions plus the offer-outcome exception above.
 *
 * Expanding coverage further would require parsing additional `block_results` fields and new series
 * definitions.
 */

export const INDEXER_BLOCK_RESULTS_SCOPE =
  "block_results.txs_results, plus finalize_block_events vstorage state_change on published.wallet.<addr> for offer_outcome only" as const;
