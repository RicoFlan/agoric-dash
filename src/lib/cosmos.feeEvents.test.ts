import { describe, expect, it } from "vitest";
import { extractFeePayerFromEvents, extractPaidFeesFromEvents } from "@/lib/cosmos";

/**
 * Shapes captured from agoric-3 while auditing the failed-transaction fee rule. Of 68 failed txs
 * sampled, 20 carried a committed fee (post-ante execution failures) and 48 carried none (ante
 * failures). The events alone separate the two cases, so the rollup needs no special-casing.
 */
const postAnteFailure = [
  {
    type: "tx",
    attributes: [
      { key: "fee", value: "2000ubld" },
      { key: "fee_payer", value: "agoric1avjyymefy3wzepse09q3h" },
    ],
  },
];
const anteFailure = [{ type: "tx", attributes: [{ key: "acc_seq", value: "agoric1x/7" }] }];

describe("fee events on failed transactions", () => {
  it("reads the committed fee and its payer from a post-ante failure", () => {
    expect([...extractPaidFeesFromEvents(postAnteFailure)]).toEqual([["ubld", BigInt(2000)]]);
    expect(extractFeePayerFromEvents(postAnteFailure)).toBe("agoric1avjyymefy3wzepse09q3h");
  });

  it("yields nothing for an ante failure, which genuinely paid no fee", () => {
    expect(extractPaidFeesFromEvents(anteFailure).size).toBe(0);
    expect(extractFeePayerFromEvents(anteFailure)).toBeNull();
  });

  it("does not report a payer when no fee attribute accompanies it", () => {
    expect(extractFeePayerFromEvents([{ type: "tx", attributes: [{ key: "fee_payer", value: "agoric1x" }] }])).toBeNull();
  });
});
