/**
 * Frozen v1 semantic definitions for Agoric L1 dashboard metrics.
 * Aligns with stakeholder plan: native units only; paid fees from execution output.
 *
 * Machine-readable grain / inclusion rules per series: `src/lib/metricDictionary.ts`.
 * Event vs decoded-message sources per series: `src/lib/rollupSourceHierarchy.ts`.
 * IBC-in credit events may carry `msg_index` — see `src/lib/txEventMsgIndex.ts` and `ibcRecvEventAmounts.ts`.
 * Participation roles and KPI definitions: `src/lib/participantRollupPolicy.ts`.
 * Indexer RPC ingest bounds (tx_results vs block-level events): `src/lib/indexerIngestScope.ts`.
 * Chain upgrade impact on decoders / event shapes: `src/lib/protocolCompatibilityNotes.ts`.
 * Hourly vs daily rollup reconciliation: `src/lib/metricsRollupParity.ts`, `scripts/verifyRollupParity.ts`.
 */

export const CHAIN_ID = "agoric-3";

/**
 * First UTC calendar day covered by this dashboard’s indexed rollups (matches default
 * `INDEXER_START_DATE` in `.env.example`). Queries earlier than this are clamped server-side.
 */
export const INDEXED_HISTORY_FROM_DAY = "2026-01-01";

/** Default fee / staking token minimal denom on agoric-3 (for human “BLD” line items). */
export const FEE_DENOM_UBLB = "ubld";

/**
 * Long-form scope caveat for section captions next to KPIs / value tables that are derived
 * exclusively from `block_results.txs_results` (see `indexerIngestScope.ts`). Renderers append
 * this to existing captions and link the words "see Methodology" to `#methodology`.
 */
export const INDEXER_SCOPE_CAVEAT_INLINE =
  "Tx-attributed only — block-level inflation, distribution, and slashing are out of scope (see Methodology).";

/** Compact variant for tight KPI subtitle space; same semantic meaning as `INDEXER_SCOPE_CAVEAT_INLINE`. */
export const INDEXER_SCOPE_CAVEAT_SUBTITLE =
  "Tx-attributed only — excludes inflation, distribution, and slashing.";

export const DEFAULT_RPC = "https://main-a.rpc.agoric.net";

/** Successful inclusion: ABCI tx result code 0 */
export const TX_SUCCESS_CODE = 0;

/**
 * How ABCI `txs_results` rows map into `tx_success` / `tx_failed`, `gas_used`, and `fee_paid`
 * (see `accumulateBlock` in `scripts/indexer.ts`). Other series are successful-tx-only unless noted
 * in `metricDictionary.ts`.
 */
export { BLOCK_TX_RESULTS_PAIRING_POLICY } from "./blockTxResultsPairing";

export const TX_RESULT_ROLLUP_POLICY = {
  /** Each aligned block-tx + result pair increments exactly one of tx_success or tx_failed. */
  txOutcome: "partition_every_matched_pair",
  /** Sum ABCI `gas_used` for every matched pair (includes failed executions). */
  gasUsed: "includes_failed_and_successful",
  /** Parse `fee_paid` from tx events only when code === 0 (failed txs contribute no fee_paid delta). */
  feePaid: "successful_only",
} as const;

/**
 * Transfer-like value (native minimal units, per denom): bank sends + IBC ICS-20 transfer amounts.
 */
export const TRANSFER_MSG_TYPES = new Set([
  "/cosmos.bank.v1beta1.MsgSend",
  "/cosmos.bank.v1beta1.MsgMultiSend",
  "/ibc.applications.transfer.v1.MsgTransfer",
]);

/** IBC transfer (outbound from this chain when in a block on Agoric) */
export const MSG_IBC_TRANSFER = "/ibc.applications.transfer.v1.MsgTransfer";

export const MSG_RECV_PACKET = "/ibc.core.channel.v1.MsgRecvPacket";

export const SERIES = {
  TX_SUCCESS: "tx_success",
  TX_FAILED: "tx_failed",
  /** ABCI gas_used summed for every indexed tx (success and failure). */
  GAS_USED: "gas_used",
  /** Paid fees from tx_result events; successful txs only (see TX_RESULT_ROLLUP_POLICY). */
  FEE_PAID: "fee_paid",
  /** Transfer-like movements from decoded messages, per denom */
  TRANSFER_VOLUME: "transfer_volume",
  /**
   * Event-derived value moved per denom: sum of `coin_received` event amounts in successful txs
   * whose receiver is not in `AGORIC_MODULE_ACCOUNT_ADDRESSES` (see `agoricModuleAccounts.ts`).
   * Captures flows from any encompassing message — bank sends, IBC recv, Agoric bridge messages,
   * future contract patterns — independent of decoded `Msg*` coverage. Dashboard: bank credits
   * column next to gross in-tx; not additive with it (see METHODOLOGY_BLURB).
   */
  BANK_CREDITS_VOLUME: "bank_credits_volume",
  IBC_TRANSFER_OUT_COUNT: "ibc_transfer_out_count",
  IBC_TRANSFER_IN_COUNT: "ibc_transfer_in_count",
  /** Distinct recv_packet events (packet channel + sequence) per successful tx; summed in rollups for comparability with external IBC dashboards. */
  IBC_TRANSFER_FLOW_IN: "ibc_transfer_flow_in",
  IBC_TRANSFER_AMOUNT_OUT: "ibc_transfer_amount_out",
  IBC_TRANSFER_AMOUNT_IN: "ibc_transfer_amount_in",
} as const;

export const METHODOLOGY_BLURB = `
Scope: Metrics reflect Agoric mainnet (agoric-3). Indexed history for this deployment begins UTC calendar day 2026-01-01 (aligned with default INDEXER_START_DATE). Requests with From earlier than that day are clamped server-side to 2026-01-01 so dashboards stay consistent with the indexed period. Rollups come from PostgreSQL tables populated by the indexer: daily_metrics and hourly_metrics for most charts and KPIs; participant_day and address_volume_day for the Economic participation & concentration section at the bottom of the page when present. If those participation counts stay at zero, run the indexer after applying the schema (npm run db:push).

Layout (top to bottom): When /api/metrics returns indexer_state, last indexed block height (and optional updated-at text) may appear above the UTC date-range and granularity toolbar. Value handled — one denom table titled "Value by denom: gross in-tx vs bank credits (range total)" with gross in-tx and bank credits native totals side by side (non-additive); full on-chain denom strings are not shown inline — each row has a compact "View Denom" control; hover or keyboard focus opens a fixed-position tooltip (React portal to document.body) with the full string, and title plus aria-label also expose it for native tooltip / assistive tech; USD gross (EST) supports client-side sort (high / low / default ticker order); footer shows separate USD gross and USD credits totals (not additive with each other). Below the table: gross in-tx movement line chart (per-denom series can be toggled off via checkboxes), bank credits to user addresses line chart, IBC amount flows chart. Gas and fees; Transaction activity KPIs; Volume and IBC time-series (successful txs vs IBC message/flow counts, IBC traffic — each with dashed linear trend overlays). Economic participation & concentration renders only when the API includes participation and/or concentration payloads (distinct-account daily chart with trend, KPI cards, optional distinct-account-addresses-per-day table, top-10 gross USD share KPI). Hour granularity with no rows in hourly_metrics for the requested window triggers a dashboard banner: the API falls back to daily rollups for charts and KPIs for that request. Footer: expandable Methodology & caveats (this text).

Addresses are accounts, not unique humans.

Tx outcomes: Each indexed pair of block transaction bytes and the corresponding txs_results row adds exactly one count to either successful txs (ABCI code 0) or failed txs. Gas used sums ABCI gas_used for every such pair (successful and failed). Paid fees (fee_paid series) count successful txs only, from execution events—failed txs still contribute gas_used but not fee_paid in these rollups. Chart titles state when a series is success-only vs all inclusions.

Block pairing: If block.data.txs and txs_results have different lengths, the indexer pairs by index and rolls up only the first min(N, M) pairs; any extra block txs or extra result rows are omitted from these metrics (implementation: src/lib/blockTxResultsPairing.ts).

Rollup sources (Cosmos practice): Paid fees and IBC-in settlement amounts come from tx_result events where noted; bank sends and outbound ICS-20 lines decode Msg bodies (authoritative for declared movement). The bank_credits_volume series sums coin_received credits to non-module-account receivers per successful tx (module blocklist in src/config/agoricModuleAccounts.json). IBC recv headline flow counts prefer recv_packet events with MsgRecvPacket fallback. IBC-in credit sums use event msg_index when emitted so unrelated coin_received in the same tx are not folded into IBC-in — full matrix in src/lib/rollupSourceHierarchy.ts.

Indexer ingest scope: Metrics come from block_results.txs_results paired with block transactions only. BeginBlock / EndBlock–style emissions that appear solely at finalize-block scope (inflation minting, distribution to validators, standalone slash records, etc.) are not rolled up here unless the node also reflects them inside a tx result — see indexerIngestScope.ts.

Protocol upgrades: Agoric / Cosmos SDK / ibc-go releases can change protobuf message routes, typed-event layouts, or attribute keys. Indexed historical series may show step changes around upgrade heights until parsers and CosmJS types are updated and data is reprocessed — see protocolCompatibilityNotes.ts.

Stored hourly buckets should sum to the same UTC calendar-day totals as daily_metrics for each series and dimension; investigate drift with scripts/verifyRollupParity.ts (optional RPC replay for ibc_transfer_flow_in matches indexer/backfill logic).

Fees are paid amounts from transaction result events (e.g. tx/fee attributes), not the signed max fee cap alone. Gas is ABCI gas units, not a token. The primary fee KPI expresses uBLD as BLD.

Transaction vs message grain: Tx KPIs (successful / failed) count one row per aligned tx result. Transfer-volume and IBC amount series sum decoded message legs; one tx with multiple transfer msgs contributes multiple legs. ibc_transfer_out_count counts MsgTransfer messages. Display IBC-in headline counts use recv_packet flow semantics (or MsgRecvPacket fallback)—they are not whole-transaction counts and must not be summed with tx counts without relabeling.

Gross in-tx column and gross line chart use transfer_volume (decoded MsgSend, MsgMultiSend output legs, and outbound MsgTransfer token amounts) plus ibc_transfer_amount_in from successful tx events, per denom. Smart-contract-internal movement may still be absent from those decoded and IBC-in lines; the bank credits column uses coin_received to non-module receivers for a different, overlapping view of value credited on chain.

The Value handled denom table shows gross in-tx movement (same basis as the gross line chart) next to bank credits (same basis as the bank credits line chart). The two native columns often overlap the same settlement; do not add them or the two USD (EST) columns to infer a single total. Bank credits are not a subset of gross movement and are not folded into gross totals. USD (EST) cells multiply each column's full-period native total on that basis by current CoinGecko spot—they are not historical mark-to-market—and stay blank when price or decimals are unavailable. Optional COINGECKO_API_KEY (Demo tier) helps rate limits.

These totals are gross flow: legs can repeat as tokens move. They are not wallet balances, net changes, or comparable to supply or float. Each asset is a separate line (including long ibc/… hash denoms); do not sum human amounts across denoms for one "total economy." Map assets in src/config/denoms.json for symbols and decimals.

The gross movement, bank credits, and IBC amount-flow charts plot each denom with non-zero volume in the range (per direction for IBC where applicable). Axes use human units per asset when mapped—cross-asset addition is not meaningful; the denom table's two USD footer totals are likewise not additive with each other.

On selected transaction and participation time-series charts, dashed lines marked “(trend)” are ordinary least-squares fits versus bucket sequence (indices 0 through n−1), not calendar-weighted regression—they summarize coarse direction across the chosen span.

IBC direction is chain-relative (out = ICS-20 MsgTransfer committed on agoric-3; in = MsgRecvPacket / recv_packet handling as indexed on agoric-3). Headline transfer counts: one outbound count per committed MsgTransfer; inbound as distinct recv_packet keys (channel + sequence) when events expose them, else MsgRecvPacket message count. Raw ibc_transfer_in_count (MsgRecvPacket messages) remains in the database for diagnostics. IBC-in amounts (ibc_transfer_amount_in) sum both coin_received and transfer execution events that match MsgRecvPacket msg_index when emitted; typical SDK paths emit both for the same bank credit, so the combined map is a gross chain-facing index (often near the sum of the two per-type legs), not “each minimal unit counted once across event families.” Multiple MsgRecvPackets in one tx are handled per message index under the same rules, with a documented legacy tx-wide fallback when filtering yields no amounts—see src/lib/ibcRecvEventAmounts.ts, npm run inspect:ibc-recv-tx-events, and docs/ibcTransferAmountInEventInvestigation.md. The IBC amount flows chart uses event-based amounts for recv and decoded MsgTransfer token for out — not the same construction as bank + outbound transfer_volume decode alone.

IBC scope and cross-chain interpretation: These rollups are block-local to agoric-3 only. Headline ICS-20 series here do not include MsgAcknowledgement, MsgTimeout, or channel open/close handshakes as “transfer traffic.” The same economic transfer can appear as outbound activity on a counterparty chain and inbound activity here (or the reverse); summing metrics across chains or treating out-plus-in on one dashboard as “total ecosystem volume” double-counts unless each leg is labeled. Combined out+recv activity lines are chain-internal indices, not conserved net flow across the network.

Period-over-period: KPI cards compare the current range to an equal-length prior window ending immediately before the selected from date (UTC hour or calendar days per granularity). That rule is not duplicated next to the date controls.

Economic participation & concentration: Successful txs only. Signers: every account from each pubkey in auth_info.signer_infos (multi-signer txs add multiple signer rows). Fee payer: fee.granter else fee.payer else first signer — see participantRollupPolicy.ts. Distinct signers and distinct fee payers KPIs count unique addresses per role across the range (not merged across roles). “Active 1 day only” vs “2+ days” counts addresses by UTC calendar days present in participant_day with either role. Distinct-accounts line chart: per UTC day, COUNT DISTINCT address across signer ∪ fee payer rows (same address as signer and fee payer that day counts once). Top 10 gross USD share: sender-side transfer_volume legs only (not IBC recv). Agoric module accounts (vbank, fee_collector, gov, IBC transfer escrow, and similar — list in src/config/agoricModuleAccounts.json) are excluded from these counts and from the concentration top-10 at read time; relayers, vaults, smart-wallet accounts, and other non-module addresses still count when they sign or pay fees.
`;
