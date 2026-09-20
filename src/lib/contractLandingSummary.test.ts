import { describe, expect, it } from "vitest";
import { summarizeContractLandings } from "@/lib/contractLandingSummary";

const day = (d: string, installs: number, storage: string, gas: string, ambiguous = 0) => ({
  day: d, installs, storageFeeUbld: storage, gasFeeUbld: gas, ambiguousInstalls: ambiguous,
});

describe("summarizeContractLandings", () => {
  it("totals installs and both fee kinds", () => {
    const s = summarizeContractLandings(
      [day("2026-01-10", 1, "88000000", "1440430"), day("2026-02-01", 2, "200000000", "3000000")],
      { distinctInstallers: 2 }
    );
    expect(s).toMatchObject({
      installs: 3,
      distinctInstallers: 2,
      storageFeeUbld: "288000000",
      gasFeeUbld: "4440430",
      daysWithLandings: 2,
      ambiguousInstalls: 0,
      shareOfTotalBldFeesPct: null,
    });
  });

  it("counts a mixed tx toward installs but leaves its fee out of the total", () => {
    // The row stores null for an unattributable fee; the count still reflects that a contract
    // landed. Reporting both is what keeps "3 installs, 1 fee missing" from reading as "3 installs
    // that between them paid this much".
    const s = summarizeContractLandings([day("2026-01-10", 3, "88000000", "1440430", 1)], { distinctInstallers: 1 });
    expect(s).toMatchObject({ installs: 3, ambiguousInstalls: 1, storageFeeUbld: "88000000" });
  });

  it("takes the share against recorded PLUS storage, since fee_paid excludes storage", () => {
    // Recorded 4,112.40 BLD and storage 3,269.33 BLD over the same window: 44.3%, not 79.5%.
    const s = summarizeContractLandings([day("2026-01-10", 30, "3269333322", "42728336")], {
      distinctInstallers: 4,
      recordedFeePaidUbld: "4112395147",
    });
    expect(s.shareOfTotalBldFeesPct).toBeCloseTo(44.29, 1);
  });

  it("reports a null share when no recorded total was supplied", () => {
    expect(summarizeContractLandings([day("2026-01-10", 1, "1", "1")], { distinctInstallers: 1 }).shareOfTotalBldFeesPct).toBeNull();
  });

  it("reports a null share rather than 0/0 when there were no fees at all", () => {
    const s = summarizeContractLandings([day("2026-01-10", 0, "0", "0")], {
      distinctInstallers: 0,
      recordedFeePaidUbld: "0",
    });
    expect(s.shareOfTotalBldFeesPct).toBeNull();
  });

  it("is zero-valued but well-formed for an empty range", () => {
    expect(summarizeContractLandings([], { distinctInstallers: 0 })).toMatchObject({
      installs: 0, storageFeeUbld: "0", gasFeeUbld: "0", daysWithLandings: 0,
    });
  });

  it("handles ubld magnitudes exactly, without float rounding", () => {
    const big = "123456789012345678901234567890";
    expect(summarizeContractLandings([day("2026-01-10", 1, big, "0")], { distinctInstallers: 1 }).storageFeeUbld).toBe(big);
  });

  it("does not count a day with zero installs toward daysWithLandings", () => {
    expect(
      summarizeContractLandings([day("2026-01-10", 0, "0", "0"), day("2026-01-11", 1, "5", "1")], { distinctInstallers: 1 })
        .daysWithLandings
    ).toBe(1);
  });
});
