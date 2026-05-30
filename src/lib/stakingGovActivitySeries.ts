import { alignBucketSeries, type BucketPoint } from "@/lib/bucketSeriesAlign";

export type StakingGovActivityRow = {
  bucket: string;
  delegations: number;
  undelegations: number;
  redelegations: number;
  govVotes: number;
  govProposals: number;
};

export type StakingGovSeriesInput = {
  delegations: readonly BucketPoint[];
  undelegations: readonly BucketPoint[];
  redelegations: readonly BucketPoint[];
  govVotes: readonly BucketPoint[];
  govProposals: readonly BucketPoint[];
};

/** Per-bucket staking & governance message counts aligned onto a shared bucket axis for the trend chart. */
export function buildStakingGovActivityRows(
  input: StakingGovSeriesInput
): StakingGovActivityRow[] {
  return alignBucketSeries({ ...input }).map(({ bucket, values }) => ({
    bucket,
    delegations: Number(values.delegations!),
    undelegations: Number(values.undelegations!),
    redelegations: Number(values.redelegations!),
    govVotes: Number(values.govVotes!),
    govProposals: Number(values.govProposals!),
  }));
}
