import { describe, expect, it } from "vitest";
import { ProvisionPoolAccumulator, accumulateProvisionPoolFromBlock } from "@/lib/provisionPoolRollup";
import type { RpcBlockResultsResponse } from "@/lib/rpc";

const cap = (wallets: number, minted: string) =>
  `{"body":"#{\\"totalMintedConverted\\":{\\"brand\\":\\"$0.Alleged: BLD brand\\",\\"value\\":\\"+0\\"},\\"totalMintedProvided\\":{\\"brand\\":\\"$0\\",\\"value\\":\\"+${minted}\\"},\\"walletsProvisioned\\":\\"+${wallets}\\"}","slots":["board0566"]}`;

const block = (...caps: string[]): RpcBlockResultsResponse =>
  ({
    finalize_block_events: [
      {
        type: "state_change",
        attributes: [
          { key: "store", value: "vstorage" },
          { key: "key", value: "3\0published\0provisionPool\0metrics" },
          { key: "value", value: JSON.stringify({ values: caps }) },
        ],
      },
    ],
  }) as unknown as RpcBlockResultsResponse;

describe("ProvisionPoolAccumulator", () => {
  it("records the day's reading from a block", () => {
    const acc = new ProvisionPoolAccumulator();
    accumulateProvisionPoolFromBlock(block(cap(1453, "3710000000")), BigInt(100), "2026-09-20T12:00:00Z", acc);
    expect(acc.days.get("2026-09-20")).toMatchObject({
      day: "2026-09-20",
      walletsProvisioned: 1453,
      totalMintedProvided: "3710000000",
      brandBoardId: "board0566",
      updatedHeight: BigInt(100),
    });
  });

  it("keeps the highest height for a day, whatever order blocks arrive in", () => {
    // Catch-up runs blocks concurrently, so a later height can be processed first.
    const acc = new ProvisionPoolAccumulator();
    accumulateProvisionPoolFromBlock(block(cap(1460, "3720000000")), BigInt(200), "2026-09-20T18:00:00Z", acc);
    accumulateProvisionPoolFromBlock(block(cap(1453, "3710000000")), BigInt(100), "2026-09-20T12:00:00Z", acc);
    expect(acc.days.get("2026-09-20")).toMatchObject({ walletsProvisioned: 1460, updatedHeight: BigInt(200) });
  });

  it("keeps one row per day across days", () => {
    const acc = new ProvisionPoolAccumulator();
    accumulateProvisionPoolFromBlock(block(cap(1450, "3700000000")), BigInt(1), "2026-09-19T23:59:00Z", acc);
    accumulateProvisionPoolFromBlock(block(cap(1453, "3710000000")), BigInt(2), "2026-09-20T00:01:00Z", acc);
    expect(acc.size).toBe(2);
    expect(acc.days.get("2026-09-19")?.walletsProvisioned).toBe(1450);
    expect(acc.days.get("2026-09-20")?.walletsProvisioned).toBe(1453);
  });

  it("takes the last publication when a block carries several", () => {
    const acc = new ProvisionPoolAccumulator();
    accumulateProvisionPoolFromBlock(block(cap(1452, "3710000000"), cap(1453, "3710000000")), BigInt(5), "2026-09-20T00:00:00Z", acc);
    expect(acc.days.get("2026-09-20")?.walletsProvisioned).toBe(1453);
  });

  it("skips a publication missing either counter rather than storing a partial row", () => {
    // A row missing a counter cannot be differenced, and would silently poison the day's delta.
    const acc = new ProvisionPoolAccumulator();
    const partial = '{"body":"#{\\"walletsProvisioned\\":\\"+9\\"}","slots":[]}';
    accumulateProvisionPoolFromBlock(block(partial), BigInt(1), "2026-09-20T00:00:00Z", acc);
    expect(acc.size).toBe(0);
  });

  it("never throws on malformed input", () => {
    const acc = new ProvisionPoolAccumulator();
    expect(() => accumulateProvisionPoolFromBlock(block("not json"), BigInt(1), "2026-09-20T00:00:00Z", acc)).not.toThrow();
    expect(() => accumulateProvisionPoolFromBlock({} as RpcBlockResultsResponse, BigInt(1), "2026-09-20T00:00:00Z", acc)).not.toThrow();
    // An unusable block time yields nothing rather than a row keyed on garbage.
    accumulateProvisionPoolFromBlock(block(cap(1, "1")), BigInt(1), "", acc);
    expect(acc.size).toBe(0);
  });
});
