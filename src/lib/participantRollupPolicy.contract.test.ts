import { describe, expect, it } from "vitest";
import { PARTICIPANT_ROLES } from "@/lib/participantRollupPolicy";

describe("PARTICIPANT_ROLES", () => {
  it("matches indexer / DB role strings", () => {
    expect(PARTICIPANT_ROLES.SIGNER).toBe("signer");
    expect(PARTICIPANT_ROLES.FEE_PAYER).toBe("fee_payer");
  });
});
