import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INDEXED_HISTORY_FROM_DAY } from "@/lib/semantics";

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
    expect(raw).toMatch(/^RPC_URL_FALLBACK=/m);
    expect(raw).toMatch(/INDEXER_BATCH=/);
    expect(raw).toMatch(/INDEXER_POLL_MS=/);
    expect(raw).toMatch(/INDEXER_LAG=/);
  });

  it("documents optional CoinGecko key for USD estimates", () => {
    expect(raw).toMatch(/COINGECKO_API_KEY/);
  });

  it("documents per-block RPC retries for indexer and backfills", () => {
    expect(raw).toMatch(/INDEXER_RPC_RETRIES=/);
  });

  it("documents optional backfill skip-delete flag", () => {
    expect(raw).toMatch(/BACKFILL_SKIP_DELETE/);
  });

  it("documents optional scanIbcRecvDay env overrides", () => {
    expect(raw).toMatch(/SCAN_CONCURRENCY/);
    expect(raw).toMatch(/SCAN_HEIGHT_START/);
    expect(raw).toMatch(/SCAN_HEIGHT_END_EXCLUSIVE/);
  });

  it("default INDEXER_START_DATE calendar day matches INDEXED_HISTORY_FROM_DAY", () => {
    const line = raw.split("\n").find((l) => l.startsWith("INDEXER_START_DATE="));
    expect(line).toBeDefined();
    expect(line!.slice("INDEXER_START_DATE=".length)).toContain(INDEXED_HISTORY_FROM_DAY);
  });
});
