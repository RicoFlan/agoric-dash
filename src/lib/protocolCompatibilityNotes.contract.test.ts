import { describe, expect, it } from "vitest";
import { DECODE_STACK_COSMJS_MAJOR } from "@/lib/protocolCompatibilityNotes";

describe("protocolCompatibilityNotes", () => {
  it("pins documented CosmJS line for decode stack audits", () => {
    expect(DECODE_STACK_COSMJS_MAJOR).toMatch(/^0\.\d+\.x$/);
  });
});
