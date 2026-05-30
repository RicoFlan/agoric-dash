import { describe, expect, it } from "vitest";
import { buildStakingGovActivityRows } from "./stakingGovActivitySeries";

describe("buildStakingGovActivityRows", () => {
  it("aligns all five count series onto a shared sorted bucket axis", () => {
    const rows = buildStakingGovActivityRows({
      delegations: [
        { bucket: "2026-01-02", value: "3" },
        { bucket: "2026-01-01", value: "1" },
      ],
      undelegations: [{ bucket: "2026-01-01", value: "2" }],
      redelegations: [],
      govVotes: [{ bucket: "2026-01-02", value: "7" }],
      govProposals: [],
    });
    expect(rows.map((r) => r.bucket)).toEqual(["2026-01-01", "2026-01-02"]);
    expect(rows[0]).toEqual({
      bucket: "2026-01-01",
      delegations: 1,
      undelegations: 2,
      redelegations: 0,
      govVotes: 0,
      govProposals: 0,
    });
    expect(rows[1]).toEqual({
      bucket: "2026-01-02",
      delegations: 3,
      undelegations: 0,
      redelegations: 0,
      govVotes: 7,
      govProposals: 0,
    });
  });
});
