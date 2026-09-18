import { describe, expect, it } from "vitest";
import {
  MAX_TRACKED_KEYS,
  drainResolutionWarning,
  formatResolutionWarning,
  newResolutionWarnings,
  recordResolution,
} from "@/lib/offerResolutionWarnings";

const obs = (o: Partial<Parameters<typeof recordResolution>[1]>) => ({
  instanceBoardId: null,
  instanceName: null,
  maker: null,
  category: "other",
  ...o,
});

describe("offer resolution warnings", () => {
  it("says nothing when everything resolved", () => {
    const acc = newResolutionWarnings();
    recordResolution(acc, obs({ instanceBoardId: "board1", instanceName: "ymax0", category: "ymax" }));
    recordResolution(acc, obs({ maker: "SimpleRebalance", category: "ymax" }));
    expect(formatResolutionWarning(acc)).toBeNull();
    expect(acc.totalActions).toBe(2);
  });

  it("flags a Board id the name map did not know — the stale-map case", () => {
    const acc = newResolutionWarnings();
    // A contract redeployed after agoricNames.json was generated: new Board id, no name, and its
    // offers quietly become `other`. This is the decay the signal exists to catch.
    recordResolution(acc, obs({ instanceBoardId: "board99new", instanceName: null }));
    recordResolution(acc, obs({ instanceBoardId: "board99new", instanceName: null }));
    const msg = formatResolutionWarning(acc)!;
    expect(msg).toContain("board99new×2");
    expect(msg).toContain("refreshAgoricNames");
  });

  it("flags an unresolved instance even when the action still got a category", () => {
    // The map is wrong whether or not the maker fallback rescued this particular offer.
    const acc = newResolutionWarnings();
    recordResolution(acc, obs({ instanceBoardId: "boardX", instanceName: null, maker: "SubmitEvidence", category: "fast_usdc" }));
    expect(formatResolutionWarning(acc)).toContain("boardX×1");
  });

  it("flags an unclassified maker only for instance-less offers", () => {
    const acc = newResolutionWarnings();
    recordResolution(acc, obs({ maker: "Withdraw" }));
    recordResolution(acc, obs({ maker: "Deposit" }));
    // An offer that DID name an instance is a map problem, not a maker-rule candidate.
    recordResolution(acc, obs({ instanceBoardId: "boardY", instanceName: null, maker: "Withdraw" }));
    expect(acc.unclassifiedMakers.get("Withdraw")).toBe(1);
    expect(acc.unclassifiedMakers.get("Deposit")).toBe(1);
    const msg = formatResolutionWarning(acc)!;
    expect(msg).toContain("MAKER_CATEGORY");
  });

  it("ranks by frequency so the loudest problem is the one named", () => {
    const acc = newResolutionWarnings();
    for (let i = 0; i < 9; i++) recordResolution(acc, obs({ maker: "Withdraw" }));
    recordResolution(acc, obs({ maker: "Deposit" }));
    expect(formatResolutionWarning(acc, 1)).toContain("Withdraw×9");
    expect(formatResolutionWarning(acc, 1)).not.toContain("Deposit");
  });

  it("reports the total so a count reads as a share", () => {
    const acc = newResolutionWarnings();
    recordResolution(acc, obs({ maker: "Withdraw" }));
    for (let i = 0; i < 99; i++) recordResolution(acc, obs({ category: "ymax", maker: "SimpleRebalance" }));
    expect(formatResolutionWarning(acc)).toContain("of 100 actions");
  });

  it("reports each interval, not everything since process start", () => {
    // A cumulative counter cannot say whether the problem is happening now, and after a map refresh
    // it would keep reporting the old failures until the process restarted.
    const acc = newResolutionWarnings();
    recordResolution(acc, obs({ instanceBoardId: "boardStale", instanceName: null }));
    expect(drainResolutionWarning(acc)).toContain("boardStale×1");

    // Next interval: the problem is fixed, so the line goes quiet.
    recordResolution(acc, obs({ instanceBoardId: "boardStale", instanceName: "nowResolved", category: "ymax" }));
    expect(drainResolutionWarning(acc)).toBeNull();
  });

  it("drains even on a quiet interval, so counts cannot carry forward", () => {
    const acc = newResolutionWarnings();
    recordResolution(acc, obs({ category: "ymax", maker: "SimpleRebalance" }));
    expect(drainResolutionWarning(acc)).toBeNull();
    expect(acc.totalActions).toBe(0);
  });

  it("keeps since-start totals for context once more than one interval has run", () => {
    const acc = newResolutionWarnings();
    recordResolution(acc, obs({ maker: "Withdraw" }));
    drainResolutionWarning(acc);
    recordResolution(acc, obs({ maker: "Withdraw" }));
    const msg = formatResolutionWarning(acc)!;
    expect(msg).toContain("this interval");
    expect(msg).toContain("since start 0 unresolved / 2 unclassified of 2");
  });

  it("bounds memory against chain-controlled keys and says how many it dropped", () => {
    // Both maps are keyed by strings the chain supplies, so an unbounded key space is a leak an
    // adversary could drive. Overflow is counted, not silently absorbed.
    const acc = newResolutionWarnings();
    for (let i = 0; i < MAX_TRACKED_KEYS + 25; i++) recordResolution(acc, obs({ maker: `junk${i}` }));
    expect(acc.unclassifiedMakers.size).toBe(MAX_TRACKED_KEYS);
    expect(acc.droppedKeys).toBe(25);
    expect(formatResolutionWarning(acc)).toContain("dropped at the 200-key ceiling");
    // A key already being tracked still counts after the ceiling is reached.
    recordResolution(acc, obs({ maker: "junk0" }));
    expect(acc.unclassifiedMakers.get("junk0")).toBe(2);
    expect(acc.droppedKeys).toBe(25);
  });
});
