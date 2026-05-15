import { describe, expect, it } from "vitest";
import {
  compareGrossRowsByUsd,
  compareGrossRowsDefault,
  parseUsdEstimateSortKey,
  sortGrossMovementRows,
  type GrossMovementRow,
} from "@/lib/grossTableUsdSort";

function row(partial: Partial<GrossMovementRow> & Pick<GrossMovementRow, "denom">): GrossMovementRow {
  return {
    key: partial.key ?? partial.denom,
    ticker: partial.ticker ?? "X",
    grossDisplay: partial.grossDisplay ?? "0",
    grossUnknown: partial.grossUnknown ?? false,
    usd: partial.usd ?? null,
    creditsDisplay: partial.creditsDisplay ?? "—",
    creditsUnknown: partial.creditsUnknown ?? false,
    creditsUsd: partial.creditsUsd ?? null,
    denom: partial.denom,
  };
}

describe("parseUsdEstimateSortKey", () => {
  it("parses Intl USD currency strings", () => {
    expect(parseUsdEstimateSortKey("$1,234.56")).toBeCloseTo(1234.56);
    expect(parseUsdEstimateSortKey("$0.0012")).toBeCloseTo(0.0012);
  });

  it("returns NaN for missing or sentinel", () => {
    expect(Number.isNaN(parseUsdEstimateSortKey(null))).toBe(true);
    expect(Number.isNaN(parseUsdEstimateSortKey("—"))).toBe(true);
    expect(Number.isNaN(parseUsdEstimateSortKey(""))).toBe(true);
  });
});

describe("compareGrossRowsDefault", () => {
  it("sorts by ticker then denom", () => {
    const a = row({ denom: "a", ticker: "AAA" });
    const b = row({ denom: "b", ticker: "BBB" });
    expect(compareGrossRowsDefault(a, b)).toBeLessThan(0);
    expect(compareGrossRowsDefault(b, a)).toBeGreaterThan(0);
  });

  it("breaks ties by denom when tickers match (creditsUsd ignored)", () => {
    const first = row({ denom: "denom-a", ticker: "SAME", creditsUsd: "$999.00" });
    const second = row({ denom: "denom-z", ticker: "SAME", creditsUsd: "$0.01" });
    expect(compareGrossRowsDefault(first, second)).toBeLessThan(0);
  });
});

describe("compareGrossRowsByUsd", () => {
  it("orders desc by numeric USD", () => {
    const low = row({ denom: "x", usd: "$10.00" });
    const high = row({ denom: "y", usd: "$99.00" });
    expect(compareGrossRowsByUsd(high, low, "desc")).toBeLessThan(0);
    expect(compareGrossRowsByUsd(low, high, "asc")).toBeLessThan(0);
  });

  it("places unpriced rows after priced rows", () => {
    const priced = row({ denom: "a", usd: "$5.00" });
    const unpriced = row({ denom: "b", usd: null });
    expect(compareGrossRowsByUsd(unpriced, priced, "desc")).toBeGreaterThan(0);
    expect(compareGrossRowsByUsd(priced, unpriced, "desc")).toBeLessThan(0);
  });

  it("ties break with default comparator", () => {
    const a = row({ denom: "z", ticker: "T", usd: "$1.00" });
    const b = row({ denom: "a", ticker: "T", usd: "$1.00" });
    expect(compareGrossRowsByUsd(a, b, "asc")).toBeGreaterThan(0);
  });
});

describe("sortGrossMovementRows", () => {
  it("applies default vs USD sort modes", () => {
    const rows = [
      row({ denom: "d1", ticker: "B", usd: "$2.00" }),
      row({ denom: "d2", ticker: "A", usd: "$100.00" }),
    ];
    const def = sortGrossMovementRows(rows, "default");
    expect(def.map((r) => r.ticker)).toEqual(["A", "B"]);

    const desc = sortGrossMovementRows(rows, "desc");
    expect(desc.map((r) => r.denom)).toEqual(["d2", "d1"]);
  });

  it("sorts by gross USD (usd), not creditsUsd", () => {
    const rows = [
      row({ denom: "lowGross", ticker: "L", usd: "$1.00", creditsUsd: "$999.00" }),
      row({ denom: "highGross", ticker: "H", usd: "$50.00", creditsUsd: "$0.01" }),
    ];
    const desc = sortGrossMovementRows(rows, "desc");
    expect(desc.map((r) => r.denom)).toEqual(["highGross", "lowGross"]);
  });
});
