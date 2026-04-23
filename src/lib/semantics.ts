/**
 * Frozen v1 semantic definitions for Agoric L1 dashboard metrics.
 * Aligns with stakeholder plan: native units only; paid fees from execution output.
 */

export const CHAIN_ID = "agoric-3";

export const DEFAULT_RPC = "https://main.rpc.agoric.net";

/** Successful inclusion: ABCI tx result code 0 */
export const TX_SUCCESS_CODE = 0;

/**
 * Composition by message type uses the **first** message in the tx body (documented in UI).
 */
export const MESSAGE_ATTRIBUTION = "first_message" as const;

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
  /** First message type URL counts */
  MSG_TYPE: "msg_type",
  IBC_TRANSFER_OUT_COUNT: "ibc_transfer_out_count",
  IBC_TRANSFER_IN_COUNT: "ibc_transfer_in_count",
  IBC_TRANSFER_AMOUNT_OUT: "ibc_transfer_amount_out",
  IBC_TRANSFER_AMOUNT_IN: "ibc_transfer_amount_in",
} as const;

export const METHODOLOGY_BLURB = `
Metrics use on-chain data indexed from Agoric mainnet (agoric-3). Addresses are accounts, not unique humans.
Transaction volume counts included transactions; primary KPI uses successful txs (ABCI code 0) unless noted.
Fees are paid fees taken from transaction result events (e.g. tx/fee attributes), not the declared max fee cap in the signed tx.
Transfer values sum bank and IBC transfer message amounts in native minimal units per denom—contract-internal flows may be absent.
IBC direction is chain-relative (out = MsgTransfer from this chain; in = packet receive handling where indexed).
Period-over-period compares the prior window of equal length ending at the start of the selected range.
`;
