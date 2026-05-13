import { describe, expect, it } from "vitest";
import {
  formatNewTypeUrlLog,
  noteFirstSeenTypeUrl,
} from "@/lib/typeUrlObservability";

describe("noteFirstSeenTypeUrl", () => {
  it("returns true and adds the typeUrl on first encounter", () => {
    const seen = new Set<string>();
    expect(noteFirstSeenTypeUrl(seen, "/cosmos.bank.v1beta1.MsgSend")).toBe(true);
    expect(seen.has("/cosmos.bank.v1beta1.MsgSend")).toBe(true);
  });

  it("returns false on repeat without growing the set", () => {
    const seen = new Set<string>();
    noteFirstSeenTypeUrl(seen, "/cosmos.bank.v1beta1.MsgSend");
    expect(noteFirstSeenTypeUrl(seen, "/cosmos.bank.v1beta1.MsgSend")).toBe(false);
    expect(seen.size).toBe(1);
  });

  it("treats distinct typeUrls independently", () => {
    const seen = new Set<string>();
    expect(noteFirstSeenTypeUrl(seen, "/cosmos.bank.v1beta1.MsgSend")).toBe(true);
    expect(noteFirstSeenTypeUrl(seen, "/ibc.core.channel.v1.MsgRecvPacket")).toBe(true);
    expect(noteFirstSeenTypeUrl(seen, "/agoric.swingset.MsgWalletSpendAction")).toBe(true);
    expect(seen.size).toBe(3);
  });
});

describe("formatNewTypeUrlLog", () => {
  it("includes typeUrl, height, and tx index", () => {
    const msg = formatNewTypeUrlLog("/agoric.swingset.MsgWalletSpendAction", "26012345", 7);
    expect(msg).toContain("/agoric.swingset.MsgWalletSpendAction");
    expect(msg).toContain("26012345");
    expect(msg).toContain("tx_idx 7");
  });

  it("is a stable, prefixed indexer diagnostic line", () => {
    const msg = formatNewTypeUrlLog("/cosmos.bank.v1beta1.MsgSend", "1", 0);
    expect(msg.startsWith("[indexer]")).toBe(true);
  });
});
