import { describe, expect, it } from "vitest";
import { csvField, csvRow, exportFilename, toCsv } from "@/lib/csv";

describe("csvField", () => {
  it("leaves plain values alone", () => {
    expect(csvField("vaults")).toBe("vaults");
    expect(csvField(42)).toBe("42");
  });

  it("quotes separators, quotes, newlines and edge whitespace", () => {
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
    expect(csvField(" padded ")).toBe('" padded "');
  });

  it("writes null and undefined as an empty field", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });

  it("does not round large chain amounts", () => {
    const big = "123456789012345678901234567890";
    expect(csvField(big)).toBe(big);
  });
});

describe("csvRow / toCsv", () => {
  it("joins fields and terminates rows with CRLF", () => {
    expect(csvRow(["a", "b,c"])).toBe('a,"b,c"');
    expect(toCsv(["day", "value"], [["2026-01-01", "5"]])).toBe("day,value\r\n2026-01-01,5\r\n");
  });

  it("writes a header-only file when there are no rows", () => {
    expect(toCsv(["day"], [])).toBe("day\r\n");
  });
});

describe("exportFilename", () => {
  it("builds a predictable name and strips anything path-like", () => {
    expect(exportFilename("2026-08-01", "2026-08-31", "day", "csv")).toBe("agoric-metrics_2026-08-01_2026-08-31_day.csv");
    expect(exportFilename("../../etc", "x/y", "d ay", "json")).toBe("agoric-metrics_etc_xy_day.json");
  });
});
