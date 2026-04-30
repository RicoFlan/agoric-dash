import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contract tests: `.env.example` stays aligned with indexer + app docs (no runtime imports).
 */
describe(".env.example", () => {
  const raw = readFileSync(join(__dirname, "../../.env.example"), "utf8");

  it("documents bounded indexing and catch-up tuning", () => {
    expect(raw).toMatch(/INDEXER_START_DATE=/);
    expect(raw).toMatch(/INDEXER_CATCHUP_BATCH=/);
    expect(raw).toMatch(/INDEXER_CATCHUP_CONCURRENCY=/);
    expect(raw).toMatch(/INDEXER_CATCHUP_POLL_MS=/);
    expect(raw).toMatch(/INDEXER_CATCHUP_THRESHOLD_BLOCKS=/);
  });

  it("documents tail mode and RPC", () => {
    expect(raw).toMatch(/RPC_URL=/);
    expect(raw).toMatch(/INDEXER_BATCH=/);
    expect(raw).toMatch(/INDEXER_POLL_MS=/);
    expect(raw).toMatch(/INDEXER_LAG=/);
  });
});
