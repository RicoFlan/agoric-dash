/**
 * Frozen v1 semantic definitions for Agoric L1 dashboard metrics.
 * Aligns with stakeholder plan: native units only; paid fees from execution output.
 */

export const CHAIN_ID = "agoric-3";

/** Default fee / staking token minimal denom on agoric-3 (for human “BLD” line items). */
export const FEE_DENOM_UBLB = "ubld";

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
In-tx “value moving” is multi-asset: each token (including IBC hashes) is a separate line; uBLD is not a proxy for all activity. Add each asset you care about to src/config/denoms.json for display symbols. Optional spot USD in tooltips is from CoinGecko for rough cross-asset comparison only, not a mark price.
The value charts show the two largest transfer denoms in the range (by sum) and, separately, the IBC in/out amount leaders; you cannot add across denoms to get a single total.
Gas is ABCI gas units, not a token. Fees in uBLD are shown as BLD; other fee denoms appear in the fee table.
IBC direction is chain-relative (out = MsgTransfer from this chain; in = packet receive handling where indexed).
Period-over-period compares the prior window of equal length ending at the start of the selected range.
`;
