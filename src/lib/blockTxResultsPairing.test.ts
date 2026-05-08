import { describe, expect, it } from "vitest";
import {
  describeTxResultsLengthMismatch,
  pairedTxCount,
} from "@/lib/blockTxResultsPairing";

describe("pairedTxCount", () => {
  it("returns min of non-negative lengths", () => {
    expect(pairedTxCount(3, 3)).toBe(3);
    expect(pairedTxCount(5, 3)).toBe(3);
    expect(pairedTxCount(2, 7)).toBe(2);
    expect(pairedTxCount(0, 4)).toBe(0);
    expect(pairedTxCount(4, 0)).toBe(0);
  });
});

describe("describeTxResultsLengthMismatch", () => {
  it("returns null when lengths match", () => {
    expect(describeTxResultsLengthMismatch(2, 2)).toBeNull();
  });

  it("explains excess block txs", () => {
    expect(describeTxResultsLengthMismatch(5, 3)).toContain("no paired result row");
    expect(describeTxResultsLengthMismatch(5, 3)).toContain("pairing 3");
  });

  it("explains excess results rows", () => {
    expect(describeTxResultsLengthMismatch(2, 6)).toContain("no paired block tx");
    expect(describeTxResultsLengthMismatch(2, 6)).toContain("pairing 2");
  });
});
