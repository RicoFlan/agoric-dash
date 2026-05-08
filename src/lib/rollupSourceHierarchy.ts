/**
 * Cosmos-aligned rollup source hierarchy for `daily_metrics` / `hourly_metrics` series.
 * Tx-attributed only: block-level finalize events are out of scope (`indexerIngestScope.ts`).
 *
 * **Why this matters:** ABCI `tx_result` carries both structured fields (`code`, `gas_used`) and
 * module-emitted **events** (typed / legacy strings). Separately, `TxRaw.body.messages` reflects the
 * **submitted intent**. For analytics, prefer **execution outputs** (events + ABCI fields) for
 * settled fees and bank credits; use **decoded messages** for outbound ICS-20 / bank sends where the
 * indexer sums declared amounts and message-count diagnostics. Major chain upgrades can shift event
 * layouts — review `protocolCompatibilityNotes.ts` when rollups drift after an upgrade height.
 *
 * **Order of preference (IBC recv):** event-derived amounts and recv_packet identity when present;
 * decoded `MsgRecvPacket` counts used as fallback or gate per series (see each entry).
 *
 * IBC series are agoric-3 block-local; they are not a cross-chain “net flow” without counterparty
 * context (see METHODOLOGY / IBC scope).
 */

import { SERIES } from "@/lib/semantics";

export type SeriesRollupSource = {
  /** Primary signal used for the rollup delta. */
  primary: string;
  /** Fallback, decode precondition, or auxiliary signal. */
  secondary?: string;
};

/**
 * Per-series sources aligned with `scripts/indexer.ts` → `accumulateBlock`.
 */
export const SERIES_ROLLUP_SOURCE: Record<(typeof SERIES)[keyof typeof SERIES], SeriesRollupSource> = {
  [SERIES.TX_SUCCESS]: {
    primary: "ABCI tx_result.code === 0 for each aligned block tx / result pair",
  },
  [SERIES.TX_FAILED]: {
    primary: "ABCI tx_result.code !== 0 for each aligned pair",
  },
  [SERIES.GAS_USED]: {
    primary: "ABCI tx_result.gas_used for each aligned pair (success and failure)",
  },
  [SERIES.FEE_PAID]: {
    primary: "tx_result.events: type `tx`, attribute `fee` (parsed coins)",
    secondary: "Successful txs only; not inferred from TxRaw.auth_info fee field alone",
  },
  [SERIES.TRANSFER_VOLUME]: {
    primary: "Decoded MsgSend / MsgMultiSend / MsgTransfer bodies (amount fields)",
    secondary: "Successful txs only",
  },
  [SERIES.IBC_TRANSFER_OUT_COUNT]: {
    primary: "Decoded MsgTransfer messages (count per message in tx)",
    secondary: "Successful txs only",
  },
  [SERIES.IBC_TRANSFER_IN_COUNT]: {
    primary: "Decoded MsgRecvPacket messages (count per message)",
    secondary: "Diagnostic / legacy headline fallback in API display",
  },
  [SERIES.IBC_TRANSFER_FLOW_IN]: {
    primary: "tx_result.events: distinct recv_packet keys (dst port/channel + sequence) via countUniqueRecvFlowsFromTxEvents",
    secondary: "If no recv_packet keys parsed, MsgRecvPacket message count for that tx",
  },
  [SERIES.IBC_TRANSFER_AMOUNT_OUT]: {
    primary: "Decoded MsgTransfer.token amount",
    secondary: "Successful txs only",
  },
  [SERIES.IBC_TRANSFER_AMOUNT_IN]: {
    primary: "tx_result.events: coin_received + transfer attribute amounts (sumRecvCoinAmountsFromTxEvents)",
    secondary:
      "When events expose msg_index, amounts are summed only for MsgRecvPacket message indices; legacy RPC without msg_index falls back to tx-wide sum",
  },
};
