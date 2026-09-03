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
  q1_failure_rate: "Failed ÷ (successful + failed) inclusions. Failed txs consume gas but pay no fee_paid.",
  q1_paid_fees:
    "On-chain paid fees in uBLD from tx result events (what was actually paid, not the signed max), successful txs only, shown as BLD.",

  // Q2 — organic
  q2_organic_ratio:
    "Interactive-category wallet actions ÷ all wallet actions in successful txs, from the offer_category rollup (exactly one category per action). Interactive = vaults, PSM, auction, governance; automated = orchestration, oracle, fast-USDC.",
  q2_distinct_interactive_wallets:
    "Unique smart-wallet owners that submitted at least one interactive-category action in range (offer_category_participant_day). The check against a few bots inflating action counts.",
  q2_distinct_automated_wallets:
    "Unique smart-wallet owners with at least one orchestration, oracle, or fast-USDC action in range.",
  q2_satisfaction_rate:
    "Share of settled Zoe offers with numWantsSatisfied ≥ 1, counted once per offer at its terminal payout. Self-indexed from vstorage offerStatus updates.",

  // Q3 — value flow
  q3_net_ibc_flow:
    "Σ over priced assets of (IBC amount in − IBC amount out), each (asset, day) leg × that day's CoinGecko price. Positive = net inflow to Agoric. Gross flow, not TVL.",
  q3_ibc_in_usd: "IBC amounts received on agoric-3 (deduped recv_packet basis), day-priced and summed across assets.",
  q3_value_received_usd:
    "Bank credits to non-module receivers in successful txs, day-priced; broader than IBC (includes bank sends and contract/vbank flows). See Detail.",
  q3_orch_outflow:
    "Of the outflow, IBC sends executed by orchestration in EndBlock (a contract moving funds from its own Agoric account) — invisible to transaction-scoped counts. Found via YMax.",
  q3_deployed_principal:
    "Σ over YMax portfolios and positions of (totalIn − totalOut) as published to vstorage — principal currently deployed at yield venues on other chains, priced at the range end. A stock at the newest published height, not a range flow; principal, not marked to yield.",
  q3_active_portfolios: "YMax portfolios whose positions sum to positive principal, out of all portfolios ever created.",
  q3_net_deposits: "YMax deposit flows minus withdraw flows first seen in the range (from portfolio status updates), priced at the range end day.",

  // Q4 — base
  q4_effective_fee_payers:
    "1 ÷ Σ(shareᵢ²) over each fee payer's share of day-priced fee USD in range. Equals N when N addresses pay equal fees; falls toward 1 as one address dominates.",
  q4_retained_addresses:
    "Share of addresses active in this window (signer ∪ fee payer) that were also active in the equal-length prior window.",
  q4_new_addresses:
    `Share of this window's active addresses with no earlier appearance in indexed history (since ${INDEXED_HISTORY_FROM_DAY}).`,
  q4_active_multi_day: "Addresses that appeared on two or more UTC calendar days within the range.",
  q4_top10_fee_share: "Share of day-priced fee USD paid by the ten largest fee payers in range.",
} as const;

export type DefinitionId = keyof typeof DEFINITIONS;
