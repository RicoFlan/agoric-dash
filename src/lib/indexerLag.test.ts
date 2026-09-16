import { describe, expect, it } from "vitest";
import { computeIndexerLag, describeIndexerLag, LAG_STALLED_SECONDS } from "@/lib/indexerLag";

const NOW = new Date("2026-09-16T12:00:00Z");
const ago = (s: number) => new Date(NOW.getTime() - s * 1000).toISOString();

describe("computeIndexerLag", () => {
  it("reports live when the indexer is within the live window", () => {
    const l = computeIndexerLag({ lastIndexedHeight: "1000", chainHeight: "1010", updatedAt: ago(20), now: NOW });
    expect(l).toMatchObject({ blocksBehind: 10, secondsSinceUpdate: 20, level: "live", headBehindIndexer: false });
    expect(describeIndexerLag(l)).toBe("10 blocks behind head");
  });

  it("reports behind past the live window and stalled past the stalled window", () => {
    expect(computeIndexerLag({ lastIndexedHeight: "1000", chainHeight: "1500", updatedAt: ago(30), now: NOW }).level).toBe("behind");
    expect(computeIndexerLag({ lastIndexedHeight: "1000", chainHeight: "9000", updatedAt: ago(30), now: NOW }).level).toBe("stalled");
  });

  it("calls a silent indexer stalled even when the head says it is current", () => {
    const l = computeIndexerLag({
      lastIndexedHeight: "1000",
      chainHeight: "1000",
      updatedAt: ago(LAG_STALLED_SECONDS + 1),
      now: NOW,
    });
    expect(l.level).toBe("stalled");
    expect(l.blocksBehind).toBe(0);
  });

  it("clamps to zero and reports unknown when the RPC head trails the indexer", () => {
    const l = computeIndexerLag({ lastIndexedHeight: "1010", chainHeight: "1000", updatedAt: ago(10), now: NOW });
    expect(l).toMatchObject({ blocksBehind: 0, headBehindIndexer: true, level: "unknown" });
    expect(describeIndexerLag(l)).toBe("Chain head unavailable (peer lagging)");
  });

  it("degrades to unknown without a chain head, and says so when nothing is writing", () => {
    const noHead = computeIndexerLag({ lastIndexedHeight: "1000", chainHeight: null, updatedAt: ago(10), now: NOW });
    expect(noHead).toMatchObject({ blocksBehind: null, level: "unknown" });
    expect(describeIndexerLag(noHead)).toBe("Chain head unavailable");

    const dead = computeIndexerLag({ lastIndexedHeight: "1000", chainHeight: null, updatedAt: ago(3600), now: NOW });
    expect(describeIndexerLag(dead)).toBe("Indexer not writing");
  });

  it("ignores malformed heights and timestamps rather than producing NaN", () => {
    const l = computeIndexerLag({ lastIndexedHeight: "abc", chainHeight: "1.5", updatedAt: "not-a-date", now: NOW });
    expect(l).toMatchObject({ lastIndexedHeight: null, chainHeight: null, blocksBehind: null, secondsSinceUpdate: null, level: "unknown" });
  });
});
