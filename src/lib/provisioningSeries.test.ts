import { describe, expect, it } from "vitest";
import {
  SMART_WALLET_FEE_UBLD,
  buildProvisioningDays,
  summarizeProvisioning,
  type ProvisionPoolDaySnapshot,
} from "@/lib/provisioningSeries";

const snap = (day: string, walletsProvisioned: number, totalMintedProvided: string): ProvisionPoolDaySnapshot => ({
  day,
  walletsProvisioned,
  totalMintedProvided,
});

describe("buildProvisioningDays", () => {
  it("differences cumulative snapshots into per-day activity", () => {
    const days = buildProvisioningDays([
      snap("2026-09-01", 1450, "3680000000"),
      snap("2026-09-02", 1452, "3700000000"),
      snap("2026-09-03", 1453, "3710000000"),
    ]);
    expect(days[1]).toMatchObject({ day: "2026-09-02", newWallets: 2, mintedUbld: "20000000" });
    expect(days[2]).toMatchObject({ day: "2026-09-03", newWallets: 1, mintedUbld: "10000000" });
    // 10 BLD per wallet — the on-chain SMART_WALLET fee, which is the whole point of the check.
    expect(days[1]!.impliedBldPerWallet).toBeCloseTo(10);
    expect(days[1]!.matchesFee).toBe(true);
    expect(days[2]!.matchesFee).toBe(true);
  });

  it("gives the first snapshot null rather than treating it as a day of activity", () => {
    // There is nothing to difference against, and reporting its cumulative total as "new wallets"
    // would put every wallet since genesis on one day.
    const days = buildProvisioningDays([snap("2026-09-01", 1450, "3680000000")]);
    expect(days[0]).toMatchObject({ newWallets: null, mintedUbld: null, matchesFee: null, gapDays: 0 });
  });

  it("flags a day whose implied rate departs from the fee instead of smoothing it", () => {
    // Three wallets but only one wallet's worth of minting: the pool did not fund two of them.
    const days = buildProvisioningDays([snap("2026-09-01", 100, "0"), snap("2026-09-02", 103, "10000000")]);
    expect(days[1]!.newWallets).toBe(3);
    expect(days[1]!.impliedBldPerWallet).toBeCloseTo(3.333, 3);
    expect(days[1]!.matchesFee).toBe(false);
  });

  it("reports a null rate, never zero, on a day with no new wallets", () => {
    // Zero wallets is not a rate of zero BLD per wallet; it is no rate at all.
    const days = buildProvisioningDays([snap("2026-09-01", 100, "1000"), snap("2026-09-02", 100, "1000")]);
    expect(days[1]).toMatchObject({ newWallets: 0, mintedUbld: "0", impliedBldPerWallet: null, matchesFee: null });
  });

  it("counts the days skipped between publications", () => {
    // The pool publishes only when it acts, so absent days are silence, not zero.
    const days = buildProvisioningDays([snap("2026-09-01", 100, "0"), snap("2026-09-05", 101, "10000000")]);
    expect(days[1]!.gapDays).toBe(3);
    expect(days[1]!.newWallets).toBe(1);
  });

  it("refuses to report a counter that went backwards as negative activity", () => {
    // A cumulative source decreasing means a reset or a mis-read, not negative provisioning.
    const days = buildProvisioningDays([snap("2026-09-01", 100, "1000"), snap("2026-09-02", 90, "900")]);
    expect(days[1]).toMatchObject({ newWallets: null, mintedUbld: null, impliedBldPerWallet: null });
  });

  it("uses the on-chain fee constant, not a hardcoded 10", () => {
    expect(SMART_WALLET_FEE_UBLD).toBe(10_000_000);
  });
});

describe("summarizeProvisioning", () => {
  const snaps = [
    snap("2026-09-01", 1450, "3680000000"),
    snap("2026-09-02", 1452, "3700000000"),
    snap("2026-09-03", 1453, "3710000000"),
  ];

  it("totals only the differenced days and exposes the closing counters for reconciliation", () => {
    const s = summarizeProvisioning(snaps, buildProvisioningDays(snaps));
    // 2 + 1 across the two differenced days; the first snapshot contributes nothing.
    expect(s.newWallets).toBe(3);
    expect(s.mintedUbld).toBe("30000000");
    // The acceptance handle: these must equal the live chain counters at the range end.
    expect(s.closingWalletsProvisioned).toBe(1453);
    expect(s.closingTotalMintedProvided).toBe("3710000000");
    expect(s).toMatchObject({ daysOffFee: 0, daysRateChecked: 2 });
  });

  it("counts the days that disagreed with the fee", () => {
    const odd = [snap("2026-09-01", 100, "0"), snap("2026-09-02", 103, "10000000"), snap("2026-09-03", 104, "20000000")];
    const s = summarizeProvisioning(odd, buildProvisioningDays(odd));
    expect(s).toMatchObject({ daysOffFee: 1, daysRateChecked: 2, newWallets: 4 });
  });

  it("returns nulls, not zeros, when nothing could be differenced", () => {
    const one = [snap("2026-09-01", 1450, "3680000000")];
    const s = summarizeProvisioning(one, buildProvisioningDays(one));
    expect(s).toMatchObject({ newWallets: null, mintedUbld: null, closingWalletsProvisioned: 1450 });
  });

  it("is empty-safe", () => {
    expect(summarizeProvisioning([], [])).toMatchObject({ newWallets: null, closingWalletsProvisioned: null });
  });
});
