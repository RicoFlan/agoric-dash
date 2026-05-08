/**
 * Bounds what `scripts/indexer.ts` pulls from CometBFT RPC each height.
 *
 * **Included:** `GET /block` (header time + tx bytes) and `GET /block_results` **`txs_results`**
 * only — ABCI fields (`code`, `gas_used`) plus module events emitted during **that tx’s** execution.
 *
 * **Not included:** Finalize-block events attached only at block scope (Cosmos SDK BeginBlock /
 * EndBlock emissions such as minting, distribution payouts, slashing records, etc.) when those are
 * **not** mirrored inside any `txs_results` row. This dashboard’s rollups therefore do not represent
 * full chain economic flows — only activity attributable to included transactions.
 *
 * Expanding coverage would require parsing additional `block_results` fields (e.g. finalize-block
 * event blobs in ABCI++) and new series definitions.
 */

export const INDEXER_BLOCK_RESULTS_SCOPE =
  "block_results.txs_results only (no standalone finalize-block event ingestion)" as const;
