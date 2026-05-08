import { describe, expect, it } from "vitest";
import { INDEXER_BLOCK_RESULTS_SCOPE } from "@/lib/indexerIngestScope";

describe("indexerIngestScope", () => {
  it("documents txs_results-only ingestion", () => {
    expect(INDEXER_BLOCK_RESULTS_SCOPE).toContain("txs_results");
  });
});
