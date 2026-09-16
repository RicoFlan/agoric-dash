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
    "Interactive-category wallet actions ÷ all wallet actions in successful txs, from the offer_category rollup (exactly one category per action). Interactive = vaults, PSM, auction, governance, and YMax user actions (portfolio offers, EVM-wallet deposits); automated = the YMax planner and other orchestration, oracle price feeds, fast-USDC settlement.",
  q2_wallet_weighted_organic:
    "Distinct wallets with at least one user-initiated action, over distinct wallets with at least one categorized action. The wallet-weighted counterpart to the action-weighted headline: a wallet counts once however many actions it took, so a single busy bot cannot move it. A wallet active in both groups counts as user-initiated, so read this as reach rather than as a split of wallets.",
  q2_distinct_interactive_wallets:
    "Unique smart-wallet owners that submitted at least one interactive-category action in range (offer_category_participant_day). The check against a few bots inflating action counts.",
  q2_distinct_automated_wallets:
    "Unique smart-wallet owners with at least one orchestration, oracle, or fast-USDC action in range.",
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
    "Σ over YMax positions of (totalIn − totalOut), each at its latest published state. This is capital SENT to venues at cost, not those positions' current value: it excludes any yield or loss accrued there. Positions publish at different heights, so the figure mixes ages; positions whose outflow exceeds inflow are excluded and reported separately.",
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
  q4_top10_fee_share: "Share of day-priced fee USD paid by the ten largest fee payers in range.",
} as const;

export type DefinitionId = keyof typeof DEFINITIONS;
