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

export type MethodologySection = { title: string; body: string };

/** Structured sections for the Methodology & caveats panel (`MethodologyPanel.tsx`). */
export const METHODOLOGY_SECTIONS: MethodologySection[] = [
  {
    title: "Scope",
    body:
      "Metrics reflect Agoric mainnet (agoric-3). Indexed history for this deployment begins UTC calendar day 2026-01-01 (aligned with default INDEXER_START_DATE). Requests with From earlier than that day are clamped server-side to 2026-01-01. Rollups come from PostgreSQL tables populated by the indexer: daily_metrics and hourly_metrics for charts and KPIs; participant_day and address_volume_day for Economic participation & concentration when present. If participation counts stay at zero, run the indexer after npm run db:push.",
  },
  {
    title: "Layout",
    body:
      'When /api/metrics returns indexer_state, last indexed block height may appear above the date-range toolbar. Sections (top to bottom): Value handled (denom table, then Value Flow Map), Gas and fees KPIs, Transaction activity KPIs, Volume and IBC time-series (successful txs vs IBC message/flow counts; IBC traffic out vs recv — each with dashed trend overlays), Economic participation & concentration when the API includes participation and/or concentration (distinct-account chart, KPI cards, optional daily table, top-10 gross USD share). Hour granularity with no hourly_metrics rows triggers a banner: the API falls back to daily rollups for that request. This footer expands Methodology & caveats.',
  },
  {
    title: "Value handled table",
    body:
      'The table "Value by denom: gross in-tx vs bank credits (range total)" lists one row per denom. Gross in-tx = transfer_volume + indexed IBC receive (ibc_transfer_amount_in). Bank credits = coin_received to non-module receivers (bank_credits_volume). The two native columns often overlap the same settlement — do not add them or the two USD (EST) columns. USD cells multiply each column\'s full-period native total by current CoinGecko spot (not historical mark-to-market). Optional COINGECKO_API_KEY helps rate limits. "View Denom" opens the full on-chain string in a fixed tooltip (portal to document.body). USD gross (EST) sorts client-side. Footer totals are per-column only, not additive with each other. Map symbols and decimals in src/config/denoms.json.',
  },
  {
    title: "Value Flow Map",
    body:
      'Below the table: one asset at a time. Default selection = highest gross USD (EST) in range (fallback: highest gross native total). Range tiles: gross in-tx, transfer-like (range gross minus summed IBC-in), IBC-in recv, bank credits, IBC-out. "Momentum (last vs first bucket)" compares first and last time buckets in the span — not the KPI prior-window rule. Mini charts for the selected asset only: "Gross composition" (gross, transfer-like, IBC-in) and "Credits vs outbound IBC" (bank credits, IBC-out), each with dashed OLS trend overlays. Per bucket, transfer-like = gross minus IBC-in (floored at zero). Human units when mapped; use the table for cross-asset ranking.',
  },
  {
    title: "Addresses",
    body: "On-chain accounts are not unique humans. Bots, vaults, relayers, and contracts count like any address.",
  },
  {
    title: "Tx outcomes",
    body:
      "Each indexed block tx + txs_results pair adds one count to successful txs (ABCI code 0) or failed txs. Gas used sums ABCI gas_used for every pair (successful and failed). Paid fees (fee_paid) count successful txs only from execution events — failed txs contribute gas_used but not fee_paid in these rollups.",
  },
  {
    title: "Fees and gas",
    body:
      "Paid fees come from tx result events (e.g. tx/fee attributes), not the signed max-fee cap alone. Gas is ABCI gas units, not a token. The primary fee KPI shows uBLD as BLD.",
  },
  {
    title: "Block pairing",
    body:
      "If block.data.txs and txs_results differ in length, the indexer pairs by index and rolls up only the first min(N, M) pairs; extra rows are omitted (src/lib/blockTxResultsPairing.ts).",
  },
  {
    title: "Rollup sources",
    body:
      "Paid fees and IBC-in settlement amounts use tx_result events where noted; bank sends and outbound ICS-20 use decoded Msg bodies. bank_credits_volume sums coin_received to non-module receivers (src/config/agoricModuleAccounts.json). IBC recv headline counts prefer recv_packet events with MsgRecvPacket fallback. IBC-in amounts use msg_index when emitted so unrelated coin_received in the same tx are excluded — see src/lib/rollupSourceHierarchy.ts.",
  },
  {
    title: "Indexer ingest scope",
    body:
      "Metrics come from block_results.txs_results paired with block transactions only. BeginBlock/EndBlock-only emissions (inflation, distribution, slashing, etc.) are out of scope unless mirrored in a tx result — see src/lib/indexerIngestScope.ts.",
  },
  {
    title: "Transaction vs message grain",
    body:
      "Tx KPIs count one row per aligned tx result. Transfer-volume and IBC amount rollups sum message legs; multiple transfer msgs in one tx add multiple legs. ibc_transfer_out_count counts MsgTransfer messages. IBC-in headline counts use recv_packet flow semantics (or MsgRecvPacket fallback) — not whole-tx counts; do not sum them with tx counts without relabeling.",
  },
  {
    title: "Gross flow (not supply)",
    body:
      "Totals are gross flow: legs can repeat as tokens move. They are not wallet balances, net changes, or comparable to supply. Do not sum human amounts across denoms for one economy-wide total.",
  },
  {
    title: "Trend overlays",
    body:
      'On Volume and IBC charts, the distinct-accounts chart, and Value Flow Map mini charts, dashed "(trend)" lines are ordinary least-squares fits vs bucket index (0…n−1), not calendar-weighted regression.',
  },
  {
    title: "IBC direction and amounts",
    body:
      "Out = ICS-20 MsgTransfer on agoric-3; in = MsgRecvPacket / recv_packet as indexed. ibc_transfer_amount_in sums coin_received and transfer events matching MsgRecvPacket msg_index when emitted; typical SDK paths emit both for one settlement, so the combined series is a gross index (often ~2× per-type legs) — see docs/ibcTransferAmountInEventInvestigation.md and npm run inspect:ibc-recv-tx-events. Value Flow Map IBC-in/gross use those recv amounts; IBC-out uses ibc_transfer_amount_out (decoded MsgTransfer), not bank credits.",
  },
  {
    title: "IBC scope and cross-chain",
    body:
      "Rollups are block-local to agoric-3. Ack/timeouts/handshakes are not transfer traffic here. The same transfer can count on another chain too; out+recv on this dashboard is not net ecosystem flow.",
  },
  {
    title: "Period-over-period",
    body:
      "KPI cards compare the current range to an equal-length prior window ending immediately before From (UTC, per granularity). Value Flow Map momentum tiles use first vs last bucket only, not that prior window.",
  },
  {
    title: "Economic participation & concentration",
    body:
      "Successful txs only. Signers: every pubkey in signer_infos. Fee payer: fee.granter else fee.payer else first signer (participantRollupPolicy.ts). Distinct signers and fee payers are counted per role, not merged. Active 1 vs 2+ days uses UTC calendar days in participant_day. Distinct-accounts chart: one count per address per day (signer ∪ fee payer). Top 10 gross USD share: sender-side transfer_volume only (not IBC recv). Module accounts in agoricModuleAccounts.json are excluded from participation and top-10 at read time.",
  },
  {
    title: "Rollup parity and upgrades",
    body:
      "Hourly buckets should match daily_metrics per UTC day per series; investigate drift with scripts/verifyRollupParity.ts. Protocol upgrades can change event shapes — see protocolCompatibilityNotes.ts; reindex after parser updates when needed.",
  },
];

/** Legacy plain-text export (search, contracts, external docs). */
export const METHODOLOGY_BLURB = METHODOLOGY_SECTIONS.map((s) => `${s.title}: ${s.body}`).join(
  "\n\n"
);
