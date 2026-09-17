import { alignBucketSeries, type BucketPoint } from "@/lib/bucketSeriesAlign";

export type StakingGovActivityRow = {
  bucket: string;
  /** Null before this series' coverage floor: the chart must show a gap, not a line at zero. */
  delegations: number | null;
  undelegations: number | null;
  redelegations: number | null;
  govVotes: number | null;
  govProposals: number | null;
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
  const n = (v: bigint | null | undefined) => (v === null || v === undefined ? null : Number(v));
  return alignBucketSeries({ ...input }).map(({ bucket, values }) => ({
    bucket,
    delegations: n(values.delegations),
    undelegations: n(values.undelegations),
    redelegations: n(values.redelegations),
    govVotes: n(values.govVotes),
    govProposals: n(values.govProposals),
  }));
}
