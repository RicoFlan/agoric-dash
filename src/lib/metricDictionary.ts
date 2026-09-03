/**
 * Machine-readable metric catalog for Agoric L1 dashboard rollups.
 * Keep in sync with `scripts/indexer.ts`, `TX_RESULT_ROLLUP_POLICY`, `rollupSourceHierarchy.ts`, and `METHODOLOGY_SECTIONS` in semantics.ts.
 */

import { SERIES } from "@/lib/semantics";

/** What one row / increment represents for interpretation and labeling. */
export type MetricGrain =
  | "transaction"
  | "message"
  | "event"
  | "address_day"
  | "block"
  | "mixed";

/**
 * Which tx results contribute numeric deltas.
 * - `every_indexed_tx`: every matched block tx ↔ result pair (success + failure).
 * - `successful_tx_only`: ABCI `code === 0` only (decoded body + events).
 */
export type SuccessScope = "every_indexed_tx" | "successful_tx_only" | "every_indexed_block";

export type MetricStorage =
  | "daily_metrics_hourly_metrics"
  | "participant_day"
  | "address_volume_day"
  | "address_fee_day"
  | "offer_participant_day";

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
    id: SERIES.BANK_CREDITS_VOLUME,
    seriesKey: SERIES.BANK_CREDITS_VOLUME,
    storage: "daily_metrics_hourly_metrics",
    grain: "mixed",
    successScope: "successful_tx_only",
    inclusionRule:
      "Per successful tx: sum `coin_received` event `amount` fields per denom for events whose `receiver` is not in `AGORIC_MODULE_ACCOUNT_ADDRESSES` (agoricModuleAccounts.ts). Captures value moved to user-owned addresses via any encompassing message — bank sends, IBC recv credits, Agoric bridge messages — independent of decoded Msg* coverage; routing legs through module accounts (e.g., vbank/*) are excluded; multi-recipient credits each contribute.",
  },
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
    id: SERIES.GAS_WANTED,
    seriesKey: SERIES.GAS_WANTED,
    storage: "daily_metrics_hourly_metrics",
    grain: "transaction",
    successScope: "every_indexed_tx",
    inclusionRule:
      "Per aligned tx index: ABCI gas_wanted (requested) on that txs_results row (same min(N,M) pairing as gas_used); pair with gas_used for efficiency (used/wanted).",
  },
  {
    id: SERIES.BLOCK_GAS_LIMIT,
    seriesKey: SERIES.BLOCK_GAS_LIMIT,
    storage: "daily_metrics_hourly_metrics",
    grain: "block",
    successScope: "every_indexed_block",
    inclusionRule:
      "Per indexed block (once, regardless of tx outcome/count): consensus block.max_gas read from block_results.consensus_param_updates. Denominator for block-space utilization (gas) = sum(gas_used) / sum(block_gas_limit). Blocks with no positive max_gas (e.g. -1 unlimited) are excluded.",
  },
  {
    id: SERIES.IBC_TRANSFER_AMOUNT_IN,
    seriesKey: SERIES.IBC_TRANSFER_AMOUNT_IN,
    storage: "daily_metrics_hourly_metrics",
    grain: "mixed",
    successScope: "successful_tx_only",
    inclusionRule:
      "Per successful tx with MsgRecvPacket: deduped single-count basis = per-denom max(coin_received sum, transfer sum) (`sumRecvCoinAmountsDedupedFromTxEvents`), scoped by msg_index to MsgRecvPacket indices when present. ibc-go emits both event families with the same amount for one ICS-20 settlement, so max collapses the mirrored legs to a single count rather than summing them — see docs/ibcTransferAmountInEventInvestigation.md.",
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
    id: SERIES.GOV_PROPOSALS,
    seriesKey: SERIES.GOV_PROPOSALS,
    storage: "daily_metrics_hourly_metrics",
    grain: "message",
    successScope: "successful_tx_only",
    inclusionRule:
      "Per MsgSubmitProposal (gov v1 / v1beta1) in a successful tx: +1. Top-level messages only (authz MsgExec not unwrapped).",
  },
  {
    id: SERIES.GOV_VOTES,
    seriesKey: SERIES.GOV_VOTES,
    storage: "daily_metrics_hourly_metrics",
    grain: "message",
    successScope: "successful_tx_only",
    inclusionRule:
      "Per MsgVote / MsgVoteWeighted (gov v1 / v1beta1) in a successful tx: +1. Top-level messages only.",
  },
  {
    id: SERIES.STAKING_DELEGATIONS,
    seriesKey: SERIES.STAKING_DELEGATIONS,
    storage: "daily_metrics_hourly_metrics",
    grain: "message",
    successScope: "successful_tx_only",
    inclusionRule: "Per MsgDelegate in a successful tx: +1. Top-level messages only.",
  },
  {
    id: SERIES.STAKING_REDELEGATIONS,
    seriesKey: SERIES.STAKING_REDELEGATIONS,
    storage: "daily_metrics_hourly_metrics",
    grain: "message",
    successScope: "successful_tx_only",
    inclusionRule: "Per MsgBeginRedelegate in a successful tx: +1. Top-level messages only.",
  },
  {
    id: SERIES.STAKING_UNDELEGATIONS,
    seriesKey: SERIES.STAKING_UNDELEGATIONS,
    storage: "daily_metrics_hourly_metrics",
    grain: "message",
    successScope: "successful_tx_only",
    inclusionRule: "Per MsgUndelegate in a successful tx: +1. Top-level messages only.",
  },
  {
    id: SERIES.WALLET_ACTIONS,
    seriesKey: SERIES.WALLET_ACTIONS,
    storage: "daily_metrics_hourly_metrics",
    grain: "message",
    successScope: "successful_tx_only",
    inclusionRule:
      "Per decoded MsgWalletSpendAction / MsgWalletAction in a successful tx: +1, dimension = action kind (zoe_offer for executeOffer/tryExitOffer; wallet_invocation for invokeEntry; unknown otherwise). Counts delivered smart-wallet intent — not Zoe outcomes (accept/refund/payout settle later in vstorage, out of tx_results scope). Top-level messages only (authz MsgExec not unwrapped). See walletOfferSummary.ts.",
  },
  {
    id: SERIES.OFFER_SOURCE,
    seriesKey: SERIES.OFFER_SOURCE,
    storage: "daily_metrics_hourly_metrics",
    grain: "message",
    successScope: "successful_tx_only",
    inclusionRule:
      "Per zoe_offer wallet action in a successful tx: +1, dimension = invitationSpec.source (contract | agoricContract | continuing | purse | unknown). `continuing` acts on an existing seat (e.g. settlement bots); fresh contract/agoricContract offers are new intent.",
  },
  {
    id: SERIES.OFFER_INSTANCE,
    seriesKey: SERIES.OFFER_INSTANCE,
    storage: "daily_metrics_hourly_metrics",
    grain: "message",
    successScope: "successful_tx_only",
    inclusionRule:
      "Per zoe_offer that references a target Zoe Instance (invitationSpec.instance) in a successful tx: +1, dimension = Instance Board id (e.g. board02568). Resolved to a contract name at read time via agoricNames. continuing offers without an instance are not counted here.",
  },
  {
    id: SERIES.OFFER_MAKER,
    seriesKey: SERIES.OFFER_MAKER,
    storage: "daily_metrics_hourly_metrics",
    grain: "message",
    successScope: "successful_tx_only",
    inclusionRule:
      "Per zoe_offer in a successful tx with a resolvable invitation maker: +1, dimension = publicInvitationMaker | invitationMakerName | callPipe[0][0] (e.g. makeGiveMintedInvitation, SettleTransaction).",
  },
  {
    id: SERIES.INVOKE_TARGET,
    seriesKey: SERIES.INVOKE_TARGET,
    storage: "daily_metrics_hourly_metrics",
    grain: "message",
    successScope: "successful_tx_only",
    inclusionRule:
      "Per wallet_invocation (invokeEntry) in a successful tx: +1, dimension = message.targetName (e.g. evmWalletHandler, planner). These are direct smart-wallet entry invocations (orchestration/EVM), not Zoe offers.",
  },
  {
    id: SERIES.OFFER_CATEGORY,
    seriesKey: SERIES.OFFER_CATEGORY,
    storage: "daily_metrics_hourly_metrics",
    grain: "message",
    successScope: "successful_tx_only",
    inclusionRule:
      "Per wallet action in a successful tx: +1 to exactly one functional category, dimension ∈ oracle | governance | vaults | psm | auction | fast_usdc | orchestration | other. Category = classifyOfferCategory(kind, source, resolved Instance name via agoricNames.json, maker, targetName) — see offerCategory.ts. Additive/non-overlapping (one per action), so it covers continuing/instance-less offers (e.g. fast_usdc settlement) that offer_instance omits. Baked at index time from the committed name map (refresh via scripts/refreshAgoricNames.ts on reindex); the category→automated/interactive grouping is applied at read time and is refinable without reindex.",
  },
  {
    id: SERIES.IBC_TRANSFER_AMOUNT_OUT_ORCH,
    seriesKey: SERIES.IBC_TRANSFER_AMOUNT_OUT_ORCH,
    storage: "daily_metrics_hourly_metrics",
    grain: "event",
    successScope: "every_indexed_block",
    inclusionRule:
      "Per send_packet event with packet_src_port=transfer in block_results.finalize_block_events (EndBlock/BeginBlock mode only): sum the ICS-20 packet amount, dimension = the packet denom normalised to the on-chain id (trace path → ibc/SHA256, native denoms unchanged). These are orchestration sends (vlocalchain acting for LocalChainAccounts) and never appear in txs_results, so they are disjoint from ibc_transfer_amount_out; Q3 net flow subtracts both.",
  },
  {
    id: SERIES.IBC_TRANSFER_OUT_COUNT_ORCH,
    seriesKey: SERIES.IBC_TRANSFER_OUT_COUNT_ORCH,
    storage: "daily_metrics_hourly_metrics",
    grain: "event",
    successScope: "every_indexed_block",
    inclusionRule: "Count of the events summed by ibc_transfer_amount_out_orch; dimension = \"\".",
  },
  {
    id: SERIES.OFFER_OUTCOME,
    seriesKey: SERIES.OFFER_OUTCOME,
    storage: "daily_metrics_hourly_metrics",
    grain: "event",
    successScope: "every_indexed_block",
    inclusionRule:
      "Per settled Zoe offer, counted once at its terminal offerStatus update (the cumulative update carrying `payouts`), self-indexed from vstorage `published.wallet.<addr>` state_change events in block_results.finalize_block_events: +1 to exactly one of wants_satisfied (numWantsSatisfied ≥ 1) | wants_unsatisfied (numWantsSatisfied === 0, refund) | errored (status carries an error). Mutually exclusive/additive → total settled offers. Block-grain (EndBlock vstorage), so unlike other offer_* series it is outside tx_results scope; intermediate result-only / numWantsSatisfied-only publications are skipped to avoid over-counting — see walletOutcomeSummary.ts.",
  },
  {
    id: SERIES.OFFER_OUTCOME_CATEGORY,
    seriesKey: SERIES.OFFER_OUTCOME_CATEGORY,
    storage: "daily_metrics_hourly_metrics",
    grain: "event",
    successScope: "every_indexed_block",
    inclusionRule:
      "Per settled Zoe offer, from the same terminal offerStatus update as offer_outcome: +1 to dimension `<category>|<outcome>`, where category = classifyOfferCategory() over the invitationSpec the smart wallet echoes in the status (OfferStatus = OfferSpec & updates; resolved Instance name via agoricNames.json, maker), or `unclassified` when the status carries no invitationSpec, and outcome ∈ wants_satisfied | wants_unsatisfied | errored. Summing over categories reproduces offer_outcome per outcome. Backs per-category satisfaction (vaults vs PSM vs auction) for Q2 — see offerOutcomeCategory.ts.",
  },
  {
    id: SERIES.OFFER_GIVE_VOLUME,
    seriesKey: SERIES.OFFER_GIVE_VOLUME,
    storage: "daily_metrics_hourly_metrics",
    grain: "message",
    successScope: "successful_tx_only",
    inclusionRule:
      "Per Zoe offer in a successful tx: sum each `give` proposal leg's atomic value, dimension = the leg brand's vbank denom (brand Board id → denom via agoricNames.json vbankAssets). Intent (escrowed), not settled value. Legs whose brand is not a vbank asset (no fungible denom) are omitted. Read-time USD reuses the denom pricing path (current spot × range total; gross flow, not net).",
  },
  {
    id: SERIES.OFFER_WANT_VOLUME,
    seriesKey: SERIES.OFFER_WANT_VOLUME,
    storage: "daily_metrics_hourly_metrics",
    grain: "message",
    successScope: "successful_tx_only",
    inclusionRule:
      "Per Zoe offer in a successful tx: sum each `want` proposal leg's atomic value, dimension = the leg brand's vbank denom. Requested amount (intent), not guaranteed; same vbank-only + USD caveats as offer_give_volume.",
  },
  {
    id: SERIES.OFFER_PAYOUT_VOLUME,
    seriesKey: SERIES.OFFER_PAYOUT_VOLUME,
    storage: "daily_metrics_hourly_metrics",
    grain: "event",
    successScope: "every_indexed_block",
    inclusionRule:
      "Per settled Zoe offer (terminal offerStatus update carrying `payouts`, from finalize_block_events vstorage — same source as offer_outcome): sum each payout leg's atomic value, dimension = the leg brand's vbank denom. What offers actually returned (refund + winnings). Counted once per offer (terminal only) to avoid over-counting; vbank-only + gross-flow USD caveats as above.",
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
  {
    id: "offer_participant_attribution",
    storage: "offer_participant_day",
    grain: "address_day",
    successScope: "successful_tx_only",
    inclusionRule:
      "UTC day × smart-wallet owner (bech32 from MsgWalletSpendAction/MsgWalletAction `owner`) × action kind: one row per distinct (day, wallet, kind) that submitted a wallet action in a successful tx. Backs distinct offer-submitting wallets — the primary anti-overcounting signal, since a handful of bot wallets dominate raw action counts.",
  },
] as const;
