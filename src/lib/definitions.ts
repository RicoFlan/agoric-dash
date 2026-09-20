/**
 * One-line definitions for every headline and support figure on the dashboard, keyed by a stable
 * indicator id. The ⓘ popovers read from here; the contract test guarantees every id has a
 * non-empty, unique definition. Longer narrative lives in METHODOLOGY_SECTIONS (/methodology).
 */
import { INDEXED_HISTORY_FROM_DAY } from "@/lib/semantics";

export const DEFINITIONS = {
  // Q1 — busier
  q1_successful_txs:
    "Count of transactions included with ABCI result code 0 in the selected range, from block_results.txs_results. Compared with an equal-length window ending just before From.",
  q1_distinct_accounts_per_day:
    "Average over the range of unique addresses per UTC day that signed or paid fees on a successful tx (each address once per day). Not users: bots and vaults inflate.",
  q1_failure_rate:
    "Failed ÷ (successful + failed) inclusions. A failure that got past the ante handler still consumed gas and still paid its fee, so those fees are counted.",
  q1_paid_fees:
    "On-chain paid fees in uBLD from tx result events (what was actually paid, not the signed max), shown as BLD. Includes transactions that failed after the ante handler, because their fee was committed; failures rejected by the ante handler emit no fee and contribute nothing.",

  // Q2 — organic
  q2_organic_ratio:
    "User-initiated wallet actions ÷ all wallet actions in successful txs, from the offer_category rollup (exactly one category per action). Over indexed history the user-initiated side is almost entirely YMax (portfolio offers and EVM-wallet deposits) with a small PSM remainder; automated = fast-USDC settlement, the YMax planner and other orchestration, and oracle price feeds. The vaults, auction and governance categories are also grouped as user-initiated but have recorded zero actions — Inter Protocol was sunset on 30 June 2025, before indexed history begins. Unclassified actions stay in the denominator, so read this with the unclassified share beside it.",
  q2_wallet_weighted_organic:
    "Distinct wallets with at least one user-initiated action, over distinct wallets with at least one categorized action. The wallet-weighted counterpart to the action-weighted headline: a wallet counts once however many actions it took, so a single busy bot cannot move it. A wallet active in both groups counts as user-initiated, so read this as reach rather than as a split of wallets.",
  q2_distinct_interactive_wallets:
    "Unique smart-wallet owners that submitted at least one user-initiated action in range (offer_category_participant_day) — in practice YMax and PSM. The check against a few bots inflating action counts.",
  q2_distinct_automated_wallets:
    "Unique smart-wallet owners with at least one orchestration, oracle, or fast-USDC action in range.",
  q2_unclassified_share:
    "Share of categorized wallet actions that no category rule could place (the `other` category ÷ all actions). These actions sit in the DENOMINATOR of both organic ratios, so they suppress them: the true user-initiated share lies between the headline and the headline plus this figure. Reads — rather than 0% when no actions were categorized in range.",
  q2_continuing_share:
    "Share of Zoe offers exercised against a seat that ALREADY EXISTS (offer_source `continuing`) rather than from a fresh invitation (contract, agoricNames path or purse). It separates managing an open position from opening one. It is NOT an automation signal: a person rebalancing their own portfolio by hand produces continuing offers exactly as a planner bot does. Offers whose source could not be determined are excluded from both sides.",
  q2_unresolved_offers:
    "Zoe offers seen in range minus offers that reached a terminal payout in range. Unresolved, NOT failed, and not all of it is stuck: an offer can stay live indefinitely with the seat open and no error published anywhere, a transaction can succeed while its offer is rejected later, and an offer made near the end of the range may simply not have settled yet. A negative value is a windowing artifact, not a data error: an offer made before the range can reach terminal payout inside it, counting toward settled but never toward seen.",
  q2_satisfaction_rate:
    "Share of settled Zoe offers whose terminal payout satisfied at least one DECLARED want (numWantsSatisfied ≥ 1), counted once per offer. It is an execution property, not user or product satisfaction, and it excludes invocations and unsettled offers.",

  // Q3 — value flow
  q3_net_ibc_flow:
    "Σ over PRICED assets of (IBC amount in − IBC amount out), each (asset, day) leg × that day's CoinGecko price. Assets with no price are excluded entirely and listed beside the figure. Outbound is counted when a transfer is initiated, not when it settles, so a timed-out and refunded transfer still reads as outflow. Observed traffic, not settled capital flow.",
  q3_ibc_in_usd: "IBC amounts received on agoric-3 (deduped recv_packet basis), day-priced and summed across assets.",
  q3_value_received_usd:
    "Bank credits to non-module receivers in successful txs, day-priced; broader than IBC (includes bank sends and contract/vbank flows). See Detail.",
  q3_orch_outflow:
    "Of the outflow, IBC sends executed by orchestration in EndBlock (a contract moving funds from its own Agoric account) — invisible to transaction-scoped counts. Found via YMax.",
  q3_deployed_principal:
    "Σ over YMax positions of (totalIn − totalOut) for venues that could be PRICED, each at its latest published state. A venue with no USD price is omitted from the figure entirely and disclosed beside it, so this is a priced subtotal rather than the whole. This is capital SENT to venues at cost, not those positions' current value: it excludes any yield or loss accrued there. Positions publish at different heights, so the figure mixes ages; positions whose outflow exceeds inflow are excluded and reported separately. It spans BOTH concurrently deployed YMax contracts, ymax0 and ymax1 — separate deployments rather than one across a redeploy, since portfolio numbering restarts in each — so the per-contract split is shown beside it.",
  q3_active_portfolios: "YMax portfolios whose positions sum to positive principal, out of all portfolios ever created.",
  q3_net_deposits: "YMax deposit flows minus withdraw flows first seen in the range (from portfolio status updates), priced at the range end day.",

  // Q4 — base
  q4_effective_fee_payers:
    "1 ÷ Σ(shareᵢ²) over each fee payer's share of day-priced fee USD in range. Equals N when N addresses pay equal fees; falls toward 1 as one address dominates. It measures who FUNDS activity, not how many people are active: the fee payer is the fee grant's granter when one is set, so a sponsor paying for many users reads as concentration.",
  q4_distinct_fee_payers:
    "Unique resolved fee payers in range (the fee grant's granter when set, otherwise the first signer). Counted per role, not merged with signers.",
  q4_retained_addresses:
    "Share of addresses active in this window (signer ∪ fee payer) that were also active in the equal-length prior window.",
  q4_new_addresses:
    `Share of this window's active addresses with no earlier appearance in indexed history (since ${INDEXED_HISTORY_FROM_DAY}).`,
  q4_active_multi_day: "Addresses that appeared on two or more UTC calendar days within the range.",
  q4_new_wallets_provisioned:
    "Smart wallets the provision pool provisioned in range, differenced from its own cumulative `walletsProvisioned` counter. Unlike distinct addresses this cannot be inflated by one actor: provisioning charges a real fee, so the count is bounded by spend. A day on which the pool published nothing has no row and is omitted rather than counted as zero.",
  q4_provisioning_funding:
    "BLD the provision pool MINTED in range, differenced from its cumulative `totalMintedProvided`. Across indexed history this equals new wallets \u00d7 the 10 BLD SMART_WALLET fee exactly, so the two figures corroborate each other. It remains the pool's FUNDING rather than a per-wallet charge: minting and provisioning happen in different blocks, and the pool's totals since genesis are about fourfold apart because wallets created before 2026 were not funded this way.",
  q4_top10_fee_share: "Share of day-priced fee USD paid by the ten largest fee payers in range.",
} as const;

export type DefinitionId = keyof typeof DEFINITIONS;
