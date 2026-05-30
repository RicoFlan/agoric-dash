import { describe, expect, it } from "vitest";
import { stakingGovSeriesForTypeUrl } from "@/lib/stakingGovMsgTypes";
import { SERIES } from "@/lib/semantics";

describe("stakingGovSeriesForTypeUrl", () => {
  it("maps staking messages", () => {
    expect(stakingGovSeriesForTypeUrl("/cosmos.staking.v1beta1.MsgDelegate")).toBe(
      SERIES.STAKING_DELEGATIONS
    );
    expect(stakingGovSeriesForTypeUrl("/cosmos.staking.v1beta1.MsgUndelegate")).toBe(
      SERIES.STAKING_UNDELEGATIONS
    );
    expect(stakingGovSeriesForTypeUrl("/cosmos.staking.v1beta1.MsgBeginRedelegate")).toBe(
      SERIES.STAKING_REDELEGATIONS
    );
  });

  it("maps gov votes across v1 and v1beta1, including weighted", () => {
    expect(stakingGovSeriesForTypeUrl("/cosmos.gov.v1beta1.MsgVote")).toBe(SERIES.GOV_VOTES);
    expect(stakingGovSeriesForTypeUrl("/cosmos.gov.v1.MsgVote")).toBe(SERIES.GOV_VOTES);
    expect(stakingGovSeriesForTypeUrl("/cosmos.gov.v1.MsgVoteWeighted")).toBe(SERIES.GOV_VOTES);
  });

  it("maps proposal submissions across versions", () => {
    expect(stakingGovSeriesForTypeUrl("/cosmos.gov.v1beta1.MsgSubmitProposal")).toBe(
      SERIES.GOV_PROPOSALS
    );
    expect(stakingGovSeriesForTypeUrl("/cosmos.gov.v1.MsgSubmitProposal")).toBe(
      SERIES.GOV_PROPOSALS
    );
  });

  it("returns null for unrelated or transfer messages", () => {
    expect(stakingGovSeriesForTypeUrl("/cosmos.bank.v1beta1.MsgSend")).toBeNull();
    expect(stakingGovSeriesForTypeUrl("/ibc.applications.transfer.v1.MsgTransfer")).toBeNull();
    expect(stakingGovSeriesForTypeUrl("")).toBeNull();
  });
});
