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
  [SERIES.GAS_WANTED]: {
    primary: "ABCI tx_result.gas_wanted for each aligned pair (success and failure)",
    secondary: "Requested/reserved gas; paired with gas_used for efficiency (used/wanted)",
  },
  [SERIES.BLOCK_GAS_LIMIT]: {
    primary: "block_results.consensus_param_updates.block.max_gas (consensus per-block gas limit), summed once per indexed block",
    secondary:
      "agoric-3 CometBFT echoes consensus params every block, so no extra RPC call; denominator for block-space utilization (gas) = sum(gas_used)/sum(block_gas_limit); excludes non-positive limits (-1 unlimited)",
  },
  [SERIES.FEE_PAID]: {
    primary: "tx_result.events: type `tx`, attribute `fee` (parsed coins)",
    secondary: "Successful txs only; not inferred from TxRaw.auth_info fee field alone",
  },
  [SERIES.TRANSFER_VOLUME]: {
    primary: "Decoded MsgSend / MsgMultiSend / MsgTransfer bodies (amount fields)",
    secondary: "Successful txs only",
  },
  [SERIES.BANK_CREDITS_VOLUME]: {
    primary:
      "tx_result.events: `coin_received` amounts summed per denom across each successful tx",
    secondary:
      "Receiver filtered against AGORIC_MODULE_ACCOUNT_ADDRESSES (agoricModuleAccounts.ts); not gated by MsgRecvPacket — overlaps but is distinct from ibc_transfer_amount_in; finalize-block events out of scope per indexerIngestScope.ts",
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
    primary:
      "tx_result.events: per-denom max(coin_received sum, transfer sum) — deduped single-count basis (sumRecvCoinAmountsDedupedFromTxEvents)",
    secondary:
      "When events expose msg_index, amounts are scoped to MsgRecvPacket message indices; legacy RPC without msg_index falls back to tx-wide sum. ibc-go emits both event types for the same credit, so max collapses the mirrored legs to one count instead of summing (docs/ibcTransferAmountInEventInvestigation.md)",
  },
  [SERIES.STAKING_DELEGATIONS]: {
    primary: "Decoded MsgDelegate messages in successful txs (count per message)",
    secondary: "Top-level messages only; authz MsgExec-wrapped delegations are not unwrapped (stakingGovMsgTypes.ts)",
  },
  [SERIES.STAKING_UNDELEGATIONS]: {
    primary: "Decoded MsgUndelegate messages in successful txs (count per message)",
    secondary: "Top-level messages only; see stakingGovMsgTypes.ts",
  },
  [SERIES.STAKING_REDELEGATIONS]: {
    primary: "Decoded MsgBeginRedelegate messages in successful txs (count per message)",
    secondary: "Top-level messages only; see stakingGovMsgTypes.ts",
  },
  [SERIES.GOV_VOTES]: {
    primary: "Decoded MsgVote / MsgVoteWeighted messages in successful txs (count per message)",
    secondary: "gov v1 and v1beta1; top-level messages only; see stakingGovMsgTypes.ts",
  },
  [SERIES.GOV_PROPOSALS]: {
    primary: "Decoded MsgSubmitProposal messages in successful txs (count per message)",
    secondary: "gov v1 and v1beta1; top-level messages only; see stakingGovMsgTypes.ts",
  },
  [SERIES.WALLET_ACTIONS]: {
    primary:
      "Decoded MsgWalletSpendAction / MsgWalletAction CapData bodies in successful txs (count per message), dimension = action kind",
    secondary:
      "Unmarshalled with @endo/marshal (walletOfferMarshal.ts) → summarized (walletOfferSummary.ts); intent only, Zoe outcomes settle later in vstorage (out of tx_results scope); top-level messages only",
  },
  [SERIES.OFFER_SOURCE]: {
    primary: "Decoded zoe_offer invitationSpec.source in successful txs (count per offer), dimension = source",
    secondary: "source ∈ contract | agoricContract | continuing | purse | unknown; continuing = acting on an existing seat",
  },
  [SERIES.OFFER_INSTANCE]: {
    primary: "Decoded zoe_offer invitationSpec.instance Board id in successful txs (count per offer), dimension = Board id",
    secondary: "Resolved to a contract name at read time via agoricNames; offers without an instance (e.g. continuing) not counted here",
  },
  [SERIES.OFFER_MAKER]: {
    primary: "Decoded zoe_offer invitation maker in successful txs (count per offer), dimension = maker name",
    secondary: "publicInvitationMaker | invitationMakerName | callPipe[0][0] (walletOfferSummary.ts)",
  },
  [SERIES.INVOKE_TARGET]: {
    primary: "Decoded wallet_invocation (invokeEntry) message.targetName in successful txs (count per invocation), dimension = targetName",
    secondary: "Direct smart-wallet entry invocations (orchestration/EVM), not Zoe offers; e.g. evmWalletHandler, planner",
  },
  [SERIES.OFFER_CATEGORY]: {
    primary:
      "Indexer-computed functional category per wallet action (count per action), dimension = category; classifyOfferCategory(kind, source, resolved Instance name, maker, targetName)",
    secondary:
      "Resolved Instance name from committed agoricNames.json (scripts/refreshAgoricNames.ts); one category per action (additive, non-overlapping) so it covers instance-less continuing offers that offer_instance omits; category→automated/interactive grouping applied at read time (offerCategory.ts)",
  },
  [SERIES.IBC_TRANSFER_AMOUNT_OUT_ORCH]: {
    primary:
      "send_packet events (packet_src_port=transfer) in block_results.finalize_block_events, i.e. EndBlock — ICS-20 packet JSON decoded from packet_data_hex; dimension = on-chain denom (trace → ibc/SHA256)",
    secondary:
      "Orchestration-originated outflow (SwingSet vlocalchain executing MsgTransfer for a LocalChainAccount); invisible to the tx-scoped ibc_transfer_amount_out. Found via YMax: H1-2026 USDC inflow ≈ $6.8M, tx-scoped outflow ≈ $1.2M, on-chain supply ≈ $25k",
  },
  [SERIES.IBC_TRANSFER_OUT_COUNT_ORCH]: {
    primary: "Count of the same EndBlock send_packet events; dimension = \"\"",
    secondary: "Pairs with ibc_transfer_out_count (tx scope) for total outbound message count",
  },
  [SERIES.OFFER_OUTCOME]: {
    primary:
      "vstorage published.wallet.<addr> offerStatus state_change in block_results.finalize_block_events (count once per settled offer at terminal payouts update), dimension = wants_satisfied | wants_unsatisfied | errored",
    secondary:
      "Self-indexed offer outcomes (no external indexer); EndBlock vstorage events, outside tx_results scope; CapData decoded with @endo/marshal (parseCapData) then summarized purely (walletOutcomeSummary.ts); intermediate non-terminal publications skipped to avoid over-counting",
  },
  [SERIES.OFFER_OUTCOME_CATEGORY]: {
    primary:
      "Same terminal offerStatus events as offer_outcome; dimension = <category>|<outcome> where category is classifyOfferCategory() over the invitationSpec echoed in the status (OfferStatus = OfferSpec & updates), or `unclassified` when absent",
    secondary:
      "Per-category satisfaction (vaults vs PSM vs auction …) without a second table; sums to offer_outcome per outcome; category rule shared with the offer_category intent rollup (offerOutcomeCategory.ts, walletActionDecode.ts)",
  },
  [SERIES.OFFER_GIVE_VOLUME]: {
    primary:
      "Decoded zoe_offer proposal.give legs in successful txs (sum atomic value), dimension = leg brand's vbank denom (agoricNames.json vbankAssets)",
    secondary:
      "Offer intent / escrowed amount, not settled; non-vbank brands omitted; read-time USD via the same denom pricing as Value handled (current spot × range total, gross flow)",
  },
  [SERIES.OFFER_WANT_VOLUME]: {
    primary:
      "Decoded zoe_offer proposal.want legs in successful txs (sum atomic value), dimension = leg brand's vbank denom",
    secondary: "Requested amount (intent), not guaranteed; same vbank-only + USD caveats as offer_give_volume",
  },
  [SERIES.OFFER_PAYOUT_VOLUME]: {
    primary:
      "vstorage offerStatus payouts at terminal settle in block_results.finalize_block_events (sum atomic value per offer, once), dimension = leg brand's vbank denom",
    secondary:
      "Same self-indexed source as offer_outcome; what offers actually returned (refund + winnings); vbank-only + gross-flow USD caveats as above",
  },
};
