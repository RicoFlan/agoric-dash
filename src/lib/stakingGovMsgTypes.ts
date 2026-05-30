/**
 * Maps staking / governance message typeUrls to their count series. These are highly defensible
 * activity signals — costly, deliberate, on-chain actions — and they live inside `txs_results`
 * (ordinary tx messages), so no ingest-scope change is needed; only decoding the message typeUrl.
 *
 * Counts are per top-level message in successful txs (one MsgVote = one vote). Messages nested inside
 * authz `MsgExec` are not unwrapped, so they are not counted here (documented limitation).
 *
 * gov v1 and v1beta1 are both mapped because chains migrate between them across SDK upgrades.
 */
import { SERIES } from "@/lib/semantics";

export const STAKING_GOV_SERIES_BY_TYPE_URL: Readonly<Record<string, string>> = {
  "/cosmos.staking.v1beta1.MsgDelegate": SERIES.STAKING_DELEGATIONS,
  "/cosmos.staking.v1beta1.MsgUndelegate": SERIES.STAKING_UNDELEGATIONS,
  "/cosmos.staking.v1beta1.MsgBeginRedelegate": SERIES.STAKING_REDELEGATIONS,
  "/cosmos.gov.v1beta1.MsgVote": SERIES.GOV_VOTES,
  "/cosmos.gov.v1.MsgVote": SERIES.GOV_VOTES,
  "/cosmos.gov.v1beta1.MsgVoteWeighted": SERIES.GOV_VOTES,
  "/cosmos.gov.v1.MsgVoteWeighted": SERIES.GOV_VOTES,
  "/cosmos.gov.v1beta1.MsgSubmitProposal": SERIES.GOV_PROPOSALS,
  "/cosmos.gov.v1.MsgSubmitProposal": SERIES.GOV_PROPOSALS,
};

/** Series to increment for a staking/gov message typeUrl, or null when not a tracked type. */
export function stakingGovSeriesForTypeUrl(typeUrl: string): string | null {
  return STAKING_GOV_SERIES_BY_TYPE_URL[typeUrl] ?? null;
}
