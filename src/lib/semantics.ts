/**
 * Frozen v1 semantic definitions for Agoric L1 dashboard metrics.
 * Aligns with stakeholder plan: native units only; paid fees from execution output.
 */

export const CHAIN_ID = "agoric-3";

/**
 * First UTC calendar day covered by this dashboard’s indexed rollups (matches default
 * `INDEXER_START_DATE` in `.env.example`). Queries earlier than this are clamped server-side.
 */
export const INDEXED_HISTORY_FROM_DAY = "2026-01-01";

/** Default fee / staking token minimal denom on agoric-3 (for human “BLD” line items). */
export const FEE_DENOM_UBLB = "ubld";

export const DEFAULT_RPC = "https://main.rpc.agoric.net";

/** Successful inclusion: ABCI tx result code 0 */
export const TX_SUCCESS_CODE = 0;

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
  GAS_USED: "gas_used",
  /** Paid fees: parsed from tx_result events (see extractPaidFeesFromEvents), per denom */
  FEE_PAID: "fee_paid",
  /** Transfer-like movements from decoded messages, per denom */
  TRANSFER_VOLUME: "transfer_volume",
  IBC_TRANSFER_OUT_COUNT: "ibc_transfer_out_count",
  IBC_TRANSFER_IN_COUNT: "ibc_transfer_in_count",
  IBC_TRANSFER_AMOUNT_OUT: "ibc_transfer_amount_out",
  IBC_TRANSFER_AMOUNT_IN: "ibc_transfer_amount_in",
} as const;

export const METHODOLOGY_BLURB = `
Scope: Metrics reflect Agoric mainnet (agoric-3). Indexed history for this deployment begins UTC calendar day 2026-01-01 (aligned with default INDEXER_START_DATE). Requests with From earlier than that day are clamped server-side to 2026-01-01 so dashboards stay consistent with the indexed period. Rollups come from PostgreSQL tables populated by the indexer: daily_metrics and hourly_metrics for most charts and KPIs; participant_day and address_volume_day for the Economic participation & concentration section at the bottom of the page. If those participation counts stay at zero, run the indexer after applying the schema (npm run db:push).

Layout (top to bottom): UTC date range and granularity controls; Value handled (gross in-tx movement table, gross transfer line chart, IBC amount flows chart); Gas and fees; Transaction activity KPIs; Volume and IBC time-series (all txs vs IBC message volume, IBC traffic); Economic participation & concentration; this methodology panel.

Addresses are accounts, not unique humans. Charts and KPIs that emphasize success count txs with ABCI result code 0 where stated; combined tx series may include failed inclusions—read chart titles and KPI labels.

Fees are paid amounts from transaction result events (e.g. tx/fee attributes), not the signed max fee cap alone. Gas is ABCI gas units, not a token. The primary fee KPI expresses uBLD as BLD.

Transfer values sum decoded bank and IBC transfer message amounts in native minimal units per denom; smart-contract-internal flows may be absent from this view.

Gross in-tx movement (table and gross line chart) sums transfer-message legs plus indexed IBC receive amounts per denom so assets with only inbound flow still appear; USD (EST) cells multiply range-native totals by current CoinGecko spot—they are not historical mark-to-market—and stay blank when price or decimals are unavailable. Optional COINGECKO_API_KEY (Demo tier) helps rate limits.

These totals are gross flow: legs can repeat as tokens move. They are not wallet balances, net changes, or comparable to supply or float. Each asset is a separate line (including long ibc/… hash denoms); do not sum human amounts across denoms for one “total economy.” Map assets in src/config/denoms.json for symbols and decimals.

The gross movement and IBC amount-flow charts plot each denom with non-zero volume in the range (per direction for IBC where applicable). Axes use human units per asset when mapped—cross-asset addition is not meaningful.

IBC direction is chain-relative (out = MsgTransfer from this chain; in = recv packet handling as indexed). The IBC amount flows chart is event- and message-based and is not the same series as the bank + gross transfer chart.

Period-over-period: KPI cards compare the current range to an equal-length prior window ending immediately before the selected from date (UTC hour or calendar days per granularity). That rule is not duplicated next to the date controls.

Economic participation & concentration: Signers and fee payers are derived only from successful txs (decoded pubkeys; fee payer is the fee-grant granter when set, otherwise the first signer). Range totals count distinct addresses per role. “Active 1 day only” vs “2+ days” classifies addresses by how many UTC calendar days in the range they appeared with any role. The daily line chart and table show distinct account addresses per UTC calendar day (signer ∪ fee payer; each address at most once per day); the chart fills each calendar day in the selected From–To range with zero when no activity was indexed. Granularity (hour/day/week) elsewhere does not change this daily series—only the span does. Top 10 gross USD share is the share of estimated gross-movement USD attributed to the ten largest address totals (CoinGecko spot × indexed sender-side legs—the same scope as MsgSend / MsgMultiSend inputs / ICS-20 senders as transfer_volume, not IBC recv legs). Bots, vaults, and protocol wallets can inflate counts.
`;
