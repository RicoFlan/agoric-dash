/**
 * Machine-readable metric catalog for Agoric L1 dashboard rollups.
 * Keep in sync with `scripts/indexer.ts`, `TX_RESULT_ROLLUP_POLICY`, `rollupSourceHierarchy.ts`, and `METHODOLOGY_BLURB` in semantics.ts.
 */

import { SERIES } from "@/lib/semantics";

/** What one row / increment represents for interpretation and labeling. */
export type MetricGrain =
  | "transaction"
  | "message"
  | "event"
  | "address_day"
  | "mixed";

/**
 * Which tx results contribute numeric deltas.
 * - `every_indexed_tx`: every matched block tx ↔ result pair (success + failure).
 * - `successful_tx_only`: ABCI `code === 0` only (decoded body + events).
 */
export type SuccessScope = "every_indexed_tx" | "successful_tx_only";

export type MetricStorage =
  | "daily_metrics_hourly_metrics"
  | "participant_day"
  | "address_volume_day"
  | "address_fee_day";

export type MetricDefinition = {
  /** Stable slug for tooling; matches `series` value when applicable. */
  id: string;
  /** Set when the metric maps to a `daily_metrics` / `hourly_metrics` series name. */
  seriesKey?: (typeof SERIES)[keyof typeof SERIES];
  storage: MetricStorage;
  grain: MetricGrain;
  successScope: SuccessScope;
  /** One-line aggregation rule aligned with indexer behavior. */
  inclusionRule: string;
};

/**
 * Ordered catalog. Series-backed rows first (alphabetically by id), then participation tables.
 */
export const METRIC_DICTIONARY: readonly MetricDefinition[] = [
  {
    id: SERIES.FEE_PAID,
    seriesKey: SERIES.FEE_PAID,
    storage: "daily_metrics_hourly_metrics",
    grain: "transaction",
    successScope: "successful_tx_only",
    inclusionRule:
      "Per successful aligned tx index: paid fees from tx_result events (`extractPaidFeesFromEvents`), summed by denom (same min(N,M) pairing as other tx metrics).",
  },
  {
    id: SERIES.GAS_USED,
    seriesKey: SERIES.GAS_USED,
    storage: "daily_metrics_hourly_metrics",
    grain: "transaction",
    successScope: "every_indexed_tx",
    inclusionRule:
      "Per aligned tx index: ABCI gas_used on that txs_results row (same min(N,M) pairing as tx_success).",
  },
  {
    id: SERIES.IBC_TRANSFER_AMOUNT_IN,
    seriesKey: SERIES.IBC_TRANSFER_AMOUNT_IN,
    storage: "daily_metrics_hourly_metrics",
    grain: "mixed",
    successScope: "successful_tx_only",
    inclusionRule:
      "Per successful tx with MsgRecvPacket: sum coin_received/transfer credits (`sumRecvCoinAmountsFromTxEvents`), scoped by msg_index to MsgRecvPacket indices when present — once per tx.",
  },
  {
    id: SERIES.IBC_TRANSFER_AMOUNT_OUT,
    seriesKey: SERIES.IBC_TRANSFER_AMOUNT_OUT,
    storage: "daily_metrics_hourly_metrics",
    grain: "message",
    successScope: "successful_tx_only",
    inclusionRule:
      "Per MsgTransfer in a successful tx: token amount on that message (ICS-20 outbound), per denom.",
  },
  {
    id: SERIES.IBC_TRANSFER_FLOW_IN,
    seriesKey: SERIES.IBC_TRANSFER_FLOW_IN,
    storage: "daily_metrics_hourly_metrics",
    grain: "event",
    successScope: "successful_tx_only",
    inclusionRule:
      "Per successful tx with recv flow: distinct recv_packet identities (channel + sequence) from events when present; else fallback count of MsgRecvPacket messages in that tx.",
  },
  {
    id: SERIES.IBC_TRANSFER_IN_COUNT,
    seriesKey: SERIES.IBC_TRANSFER_IN_COUNT,
    storage: "daily_metrics_hourly_metrics",
    grain: "message",
    successScope: "successful_tx_only",
    inclusionRule:
      "Per successful tx: number of MsgRecvPacket messages in decoded body (diagnostic vs flow-in headline).",
  },
  {
    id: SERIES.IBC_TRANSFER_OUT_COUNT,
    seriesKey: SERIES.IBC_TRANSFER_OUT_COUNT,
    storage: "daily_metrics_hourly_metrics",
    grain: "message",
    successScope: "successful_tx_only",
    inclusionRule: "Per MsgTransfer in a successful tx: +1 per outbound ICS-20 transfer message.",
  },
  {
    id: SERIES.TRANSFER_VOLUME,
    seriesKey: SERIES.TRANSFER_VOLUME,
    storage: "daily_metrics_hourly_metrics",
    grain: "message",
    successScope: "successful_tx_only",
    inclusionRule:
      "Decoded MsgSend / MsgMultiSend / MsgTransfer amounts (transfer-like msgs only), per denom; gross legs may double-count routing.",
  },
  {
    id: SERIES.TX_FAILED,
    seriesKey: SERIES.TX_FAILED,
    storage: "daily_metrics_hourly_metrics",
    grain: "transaction",
    successScope: "every_indexed_tx",
    inclusionRule:
      "Per aligned tx index with ABCI code ≠ 0: +1 failed (same index pairing as tx_success; see blockTxResultsPairing when lengths differ).",
  },
  {
    id: SERIES.TX_SUCCESS,
    seriesKey: SERIES.TX_SUCCESS,
    storage: "daily_metrics_hourly_metrics",
    grain: "transaction",
    successScope: "every_indexed_tx",
    inclusionRule:
      "Per aligned tx index with ABCI code === 0: +1 success. When block tx count and txs_results length differ, only min(N,M) index pairs are processed.",
  },
  {
    id: "participant_roles",
    storage: "participant_day",
    grain: "address_day",
    successScope: "successful_tx_only",
    inclusionRule:
      "UTC day × address × role (PARTICIPANT_ROLES): signer for each pubkey in auth_info.signer_infos; fee_payer via feePayerBech32FromAuthInfo; roles stored separately (same addr may appear twice same day).",
  },
  {
    id: "address_fee_attribution",
    storage: "address_fee_day",
    grain: "address_day",
    successScope: "successful_tx_only",
    inclusionRule:
      "Per resolved fee payer (`feePayerBech32FromAuthInfo`: granter → explicit fee.payer → first signer) and denom: increment paid fee amounts for that UTC day.",
  },
  {
    id: "address_transfer_volume_attribution",
    storage: "address_volume_day",
    grain: "address_day",
    successScope: "successful_tx_only",
    inclusionRule:
      "Sender-side legs from attributed MsgSend / MsgMultiSend / MsgTransfer for gross-movement tables (see `attributedTransferLegsFromDecodedMsg`).",
  },
] as const;
