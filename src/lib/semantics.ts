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
  /**
   * Parse `fee_paid` from tx events for EVERY matched pair. A Cosmos fee is committed by the ante
   * handler even when message execution later fails, so a post-ante failure really did pay; an ante
   * failure emits no `fee` attribute and so contributes nothing without special-casing.
   */
  feePaid: "includes_failed_and_successful",
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

/** Agoric smart-wallet messages carrying marshalled Zoe offer / invocation intent (CapData body). */
export const MSG_WALLET_SPEND_ACTION = "/agoric.swingset.MsgWalletSpendAction";
export const MSG_WALLET_ACTION = "/agoric.swingset.MsgWalletAction";
export const WALLET_ACTION_MSG_TYPES = new Set([MSG_WALLET_SPEND_ACTION, MSG_WALLET_ACTION]);

export const SERIES = {
  TX_SUCCESS: "tx_success",
  TX_FAILED: "tx_failed",
  /** ABCI gas_used summed for every indexed tx (success and failure). */
  GAS_USED: "gas_used",
  /** ABCI gas_wanted (requested) summed for every indexed tx; pairs with gas_used for efficiency. */
  GAS_WANTED: "gas_wanted",
  /** Per-block consensus max_gas summed over blocks in the bucket; denominator for block-space utilization. */
  BLOCK_GAS_LIMIT: "block_gas_limit",
  /** Paid fees from tx_result events, including post-ante failures (see TX_RESULT_ROLLUP_POLICY). */
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
  /**
   * ICS-20 sends executed in EndBlock — orchestration (vlocalchain acting for a contract's
   * LocalChainAccount), never a user tx — from block_results.finalize_block_events send_packet
   * (endBlockIbc.ts). Per denom (voucher traces normalised to ibc/HASH). Disjoint from
   * ibc_transfer_amount_out (tx scope); add both for total outflow.
   */
  IBC_TRANSFER_AMOUNT_OUT_ORCH: "ibc_transfer_amount_out_orch",
  IBC_TRANSFER_OUT_COUNT_ORCH: "ibc_transfer_out_count_orch",
  IBC_TRANSFER_AMOUNT_IN: "ibc_transfer_amount_in",
  /** Staking & governance activity (message counts in successful txs; see stakingGovMsgTypes.ts). */
  STAKING_DELEGATIONS: "staking_delegations",
  STAKING_UNDELEGATIONS: "staking_undelegations",
  STAKING_REDELEGATIONS: "staking_redelegations",
  GOV_VOTES: "gov_votes",
  GOV_PROPOSALS: "gov_proposals",
  /**
   * SwingSet/Zoe smart-wallet activity (offer intent), from decoded MsgWalletSpendAction /
   * MsgWalletAction bodies in successful txs (see walletOfferSummary.ts). These count delivered
   * actions/offers — the on-chain *intent* — not their Zoe outcomes (accept/refund/payout), which
   * settle later in vstorage and are out of tx_results scope. Dimensions carry objective structural
   * facts; the user-vs-automated judgement is derived at read time from the resolved instance/maker.
   */
  /** Wallet actions by kind; dimension = "zoe_offer" | "wallet_invocation" | "unknown". */
  WALLET_ACTIONS: "wallet_actions",
  /** Zoe offers by invitation source; dimension = "contract"|"agoricContract"|"continuing"|"purse"|"unknown". */
  OFFER_SOURCE: "offer_source",
  /** Zoe offers by target contract Instance; dimension = Board id (resolved to a contract name at read time). */
  OFFER_INSTANCE: "offer_instance",
  /** Zoe offers by invitation maker; dimension = publicInvitationMaker / invitationMakerName / callPipe[0]. */
  OFFER_MAKER: "offer_maker",
  /** Wallet invocations (invokeEntry) by target handler; dimension = message.targetName (e.g. evmWalletHandler, planner). */
  INVOKE_TARGET: "invoke_target",
  /**
   * Functional category of each wallet action (exactly one per action), computed in the indexer from
   * the resolved target Instance name (agoricNames) + invitation maker + kind. dimension =
   * oracle | governance | vaults | psm | auction | fast_usdc | orchestration | other (offerCategory.ts).
   * Unlike the marginal offer_* breakdowns, this assigns one category per action (covers continuing /
   * instance-less offers via maker), so category counts are additive and non-overlapping.
   */
  OFFER_CATEGORY: "offer_category",
  /**
   * Settled Zoe offer outcomes, self-indexed from vstorage `published.wallet.<addr>` offerStatus
   * updates that surface in block_results.finalize_block_events (no external indexer). Counted once
   * per offer at its terminal payouts update (walletOutcomeSummary.ts). dimension = wants_satisfied |
   * wants_unsatisfied | errored (mutually exclusive, additive → total settled offers).
   */
  OFFER_OUTCOME: "offer_outcome",
  /**
   * Settled Zoe offer outcomes by functional category; dimension = `<category>|<outcome>` where
   * category follows offer_category (plus `unclassified` when the terminal offerStatus carried no
   * invitationSpec) and outcome ∈ wants_satisfied | wants_unsatisfied | errored. Same counting rule
   * and source events as OFFER_OUTCOME (offerOutcomeCategory.ts); summing over categories equals it.
   */
  OFFER_OUTCOME_CATEGORY: "offer_outcome_category",
  /**
   * Summed Zoe offer `give` proposal amounts (intent, successful txs), dimension = vbank denom of the
   * leg's brand (brand Board id resolved via agoricNames.json vbankAssets). Atomic integer sums for
   * read-time USD via the existing denom pricing path. Non-vbank brands (no fungible denom) omitted.
   */
  OFFER_GIVE_VOLUME: "offer_give_volume",
  /** Summed Zoe offer `want` proposal amounts (intent), dimension = vbank denom. See OFFER_GIVE_VOLUME. */
  OFFER_WANT_VOLUME: "offer_want_volume",
  /**
   * Summed Zoe offer `payouts` amounts at terminal settle (outcome), dimension = vbank denom. Sourced
   * from the same vstorage offerStatus events as offer_outcome (block-grain); what offers actually
   * returned, vs the give/want intent above.
   */
  OFFER_PAYOUT_VOLUME: "offer_payout_volume",
} as const;

export type MethodologySection = { title: string; body: string };

/** Structured sections for the Methodology & caveats panel (`the /methodology page`). */
export const METHODOLOGY_SECTIONS: MethodologySection[] = [
  {
    title: "Scope",
    body:
      "Metrics reflect Agoric mainnet (agoric-3). Indexed history for this deployment begins UTC calendar day 2026-01-01 (aligned with default INDEXER_START_DATE). Requests with From earlier than that day are clamped server-side to 2026-01-01. Rollups come from PostgreSQL tables populated by the indexer: daily_metrics and hourly_metrics for charts and KPIs; participant_day and address_volume_day for Economic participation & concentration when present. If participation counts stay at zero, run the indexer after npm run db:push.",
  },
  {
    title: "Layout",
    body:
      'The page is organised around four questions, one section each, in this order: Q1 Is the chain busier? (successful txs vs the prior window; chart with anomaly markers; distinct accounts per day, failure rate, paid fees), Q2 Is usage becoming more organic? (interactive ÷ all wallet actions; automated-vs-interactive chart; distinct interactive/automated wallets, satisfaction by category), Q3 Is value flowing in or out? (net IBC flow in day-priced USD; per-asset net-flow chart and table), Q4 Is the economic base broadening or concentrating? (effective number of fee payers = 1 ÷ HHI; breadth-over-time chart; retention, active 2+ days, top-10 fee share). Each section has one headline with its prior-window comparison, one chart, a few support figures with an ⓘ definition, and a collapsed Detail drawer holding what was demoted: network detail (gas, fees, IBC message counts, staking & governance, success rate) under Q1; offer breakdown tables and give/want/payout value under Q2; the bank-credits-by-asset table under Q3; signer/fee-payer counts, raw HHI and distinct accounts per day under Q4. Header jump links go to the four sections and this footer. Hour granularity with no hourly_metrics rows triggers a banner: the API falls back to daily rollups for that request.',
  },
  {
    title: "Value handled table",
    body:
      'Q3 Detail: "Value received by asset (bank credits, range total)" lists one row per denom: bank credits = coin_received to non-module receivers in successful txs (bank_credits_volume), the canonical value-received basis because it captures bank sends, IBC receipts and contract/vbank flows regardless of message type. One USD column, day-priced (denom_price_day, spot fallback for missing days; the panel states the basis). The sender-side transfer_volume basis is no longer shown as a column — it remains the input for gross-movement concentration in Q4. Rows sort by USD descending, unpriced last; the raw on-chain denom string is shown truncated with the full id on hover. Map symbols and decimals in src/config/denoms.json (labels are chain-disambiguated — see "Denom labels & chains").',
  },
  {
    title: "Value Flow Map",
    body:
      "Removed in the four-questions redesign. Its one-asset-at-a-time view became Q3's net IBC flow chart (asset selector, in − out per bucket) and the per-asset net-flow table; the 'Momentum (last vs first bucket)' tiles were dropped because they used a different comparison rule from every other figure (the prior-window rule is now the only one).",
  },
  {
    title: "Denom labels & chains",
    body:
      "Many distinct ibc/… denoms are the same logical asset arriving over different bridges/chains, so labels are disambiguated as \"SYMBOL (Origin)\" — e.g. USDC (Noble) vs USDC (Axelar) vs USDC (Gravity Bridge), USDT (Wormhole), ATOM (Cosmos Hub) — to keep the Q3 tables and asset selector distinguishable. Origin is the chain the asset is native to / bridged from, derived from each denom's IBC base_denom: native micro-denoms map directly (uatom → Cosmos Hub; ubld/uist → Agoric; Stride st-tokens → Stride), bridge shapes are recognized (gravity0x… → Gravity Bridge, peggy0x… → Injective, bare 0x… → Wormhole, *-wei / uaxl → Axelar), and Circle/Noble vs Axelar uusdc/uusdt is split by Agoric's (stable) first IBC hop. base_denom is used rather than walking the full trace because historical channel numbers drift on round-trip paths. Two denoms that are the same asset from the same origin via different historical paths intentionally share a label (usually only one carries volume). Labels are cosmetic: USD pricing strips the trailing \" (…)\" tag before CoinGecko lookup, so tags never change valuations. Regenerate with scripts/refreshDenomChains.ts (writes denoms.json + public/denom-translations.csv).",
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
      "Paid fees come from tx result events (e.g. tx/fee attributes), not the signed max-fee cap alone. Gas is ABCI gas units, not a token. The primary fee KPI shows uBLD as BLD. Gas wanted is the requested/reserved gas (gas_wanted) summed over the same included txs as gas used. Two gas ratios: gas efficiency = gas_used / gas_wanted (how tightly users estimate requested gas), and block-space utilization (gas) = gas_used / block_gas_limit, where block_gas_limit sums the consensus per-block max_gas (read from block_results.consensus_param_updates, no extra RPC). Utilization is the fraction of available block gas actually consumed — a price-independent demand/contention signal; blocks with non-positive max_gas (e.g. -1 unlimited) are excluded from the denominator.",
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
    title: "Staking and governance",
    body:
      "Counts of staking and governance messages in successful txs (decoded message typeUrls): delegations (MsgDelegate), undelegations (MsgUndelegate), redelegations (MsgBeginRedelegate), governance votes (MsgVote / MsgVoteWeighted), and proposals submitted (MsgSubmitProposal). Both gov v1 and v1beta1 are counted. These are message-grain counts (one message = one action), not token amounts or unique accounts; multiple actions in one tx each count. Top-level messages only — actions wrapped in authz MsgExec are not unwrapped. These are ordinary tx messages, so they are within tx_results scope (unlike block-level inflation/distribution/slashing).",
  },
  {
    title: "Gross flow (not supply)",
    body:
      "Totals are gross flow: legs can repeat as tokens move. They are not wallet balances, net changes, or comparable to supply. Do not sum human amounts across denoms for one economy-wide total.",
  },
  {
    title: "Trend overlays",
    body:
      'On Volume and IBC charts, the distinct-accounts chart,, dashed "(trend)" lines are ordinary least-squares fits vs bucket index (0…n−1), not calendar-weighted regression.',
  },
  {
    title: "IBC direction and amounts",
    body:
      "Out = ICS-20 MsgTransfer on agoric-3; in = MsgRecvPacket / recv_packet as indexed. ibc_transfer_amount_in is a deduped single-count basis: per denom it takes max(coin_received sum, transfer sum) over events matching MsgRecvPacket msg_index when emitted. Typical SDK paths emit both event families for one settlement, so taking the max counts each base unit once instead of ~2× — see docs/ibcTransferAmountInEventInvestigation.md and npm run inspect:ibc-recv-tx-events. Q3 net IBC flow uses those recv amounts for in; out uses ibc_transfer_amount_out (decoded MsgTransfer), not bank credits.",
  },
  {
    title: "IBC scope and cross-chain",
    body:
      "Rollups are block-local to agoric-3. Ack/timeouts/handshakes are not transfer traffic here. The same transfer can count on another chain too; out+recv on this dashboard is not net ecosystem flow.",
  },
  {
    title: "Period-over-period",
    body:
      "KPI cards compare the current range to an equal-length prior window ending immediately before From (UTC, per granularity).",
  },
  {
    title: "SwingSet & Zoe offers",
    body:
      "Agoric activity is mostly SwingSet smart-wallet intent, not bare Cosmos messages. The indexer decodes MsgWalletSpendAction / MsgWalletAction CapData (@endo/marshal) and records: wallet_actions by kind (zoe_offer = executeOffer/tryExitOffer; wallet_invocation = invokeEntry), offer_source, the target contract Instance (offer_instance, Board id resolved to an agoricNames label at read time via src/config/agoricNames.json), the invitation maker (offer_maker), the invocation target (invoke_target), and exactly one functional offer_category per action (oracle, governance, vaults, psm, auction, fast_usdc, orchestration, other — offerCategory.ts; continuing/instance-less offers fall back to the maker so categories are additive and non-overlapping). The Offers activity chart groups categories into automated (orchestration/oracle/fast-USDC) vs interactive (vaults/PSM/auction/governance) — a read-time relabel, refinable without reindexing. Distinct submitting wallets come from offer_participant_day (day × owner × kind) and are the primary anti-overcounting signal: a handful of automation wallets (e.g. planner, fast-USDC settlement) submit the bulk of raw actions, so action counts are not wallet counts. Distinct-wallet counts are daily-grain by table design regardless of the selected granularity. Offer outcomes are self-indexed (no external indexer) from the same wallets' vstorage offerStatus updates, which settle asynchronously and surface as state_change events in block_results.finalize_block_events (EndBlock vstorage — outside the usual tx_results ingest scope). Each settled Zoe offer is counted once at its terminal payout update as exactly one of wants_satisfied (numWantsSatisfied ≥ 1), wants_unsatisfied (= 0, give refunded), or errored (status carries an error); intermediate result-only / numWantsSatisfied-only publications are skipped to avoid over-counting (walletOutcomeSummary.ts). Outcomes cover executeOffer Zoe offers, not invokeEntry invocations. Offer economic value is summed by vbank asset: offer_give_volume / offer_want_volume (proposal give/want intent, from successful txs) and offer_payout_volume (what settled offers returned, from the same vstorage offerStatus events). Each proposal/payout leg's brand Board id is mapped to its vbank denom + decimals (published.agoricNames.vbankAsset, committed in agoricNames.json); non-vbank brands are omitted. USD prices each day's native amount at that day's CoinGecko daily price with spot fallback for days without a stored price (same basis as Value handled — gross flow, not net, not TVL). give/want/payouts overlap (give is refunded into payouts), so their columns and USD totals are not additive.",
  },
  {
    title: "Economic participation & concentration",
    body:
      "Successful txs only. Signers: every pubkey in signer_infos. Fee payer: fee.granter else fee.payer else first signer (participantRollupPolicy.ts). Distinct signers and fee payers are counted per role, not merged. Active 1 vs 2+ days uses UTC calendar days in participant_day. Distinct-accounts chart: one count per address per day (signer ∪ fee payer). Concentration is reported on two USD bases, each leg priced at its day's CoinGecko daily price (spot fallback for missing days): gross-movement USD (top-10 share + Herfindahl HHI 0–1) over sender-side transfer_volume only (not IBC recv), and paid-fee USD (top-10 share + HHI) over resolved fee payers from address_fee_day — fees are the costliest signal and hardest to wash. HHI = Σ(addressShare²); higher means more concentrated. A concentration-over-time chart plots both HHI bases (left, 0–1) and top-10 shares (right, %) per UTC day — daily-grain regardless of the selected granularity, since address_volume_day / address_fee_day are daily; days without priced activity are gaps. Module accounts in agoricModuleAccounts.json are excluded from participation and concentration at read time.",
  },
  {
    title: "Orchestrated value (YMax)",
    body:
      "YMax — Agoric's yield product — moves user USDC to lending/vault venues on other chains by orchestration, so its value is neither on Agoric nor visible in transactions. Q3 therefore adds a STOCK metric from YMax's own published state: the indexer (and a one-off REST snapshot, scripts/seedYmaxSnapshot.ts) reads published.ymax0/ymax1.portfolios.<p> (accounts by chain, running flows with amounts) and …/positions/<venue> (cumulative totalIn / totalOut / netTransfers per protocol and chain) from the same vstorage state_change events as offer outcomes, into ymax_portfolio / ymax_position / ymax_flow (latest-wins by height). Value deployed via orchestration = Σ(totalIn − totalOut) over all positions, priced at the range end day — principal currently deployed, not marked to yield, at the newest published height; the venue table breaks it down by protocol, chain and contract version. Flows (deposit / withdraw / rebalance) are counted once at first sighting on the portfolio status and scoped to the range for net deposits. Separately, IBC sends executed in EndBlock (send_packet events in finalize_block_events — orchestration acting for a contract's LocalChainAccount, never a user tx) are rolled up as ibc_transfer_amount_out_orch so Q3's net flow subtracts them; they were the missing outflow (H1-2026 USDC inflow ≈ $6.8M, tx-scoped outflow ≈ $1.2M, on-chain supply ≈ $25k). YMax users' actions (ymax0/ymax1 offers, evmWalletHandler invocations) are the `ymax` category and count as interactive in Q2; the planner and other invocations stay orchestration (automated).",
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
