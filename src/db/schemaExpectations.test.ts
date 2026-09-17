import { describe, expect, it } from "vitest";
import { describeProblem, diffSchema, expectedTables, type ExpectedTable, type LiveColumn } from "@/db/schemaExpectations";

const liveFor = (tables: ExpectedTable[]): LiveColumn[] =>
  tables.flatMap((t) => t.columns.map((c) => ({ table: t.name, column: c.name, isNullable: !c.notNull })));

describe("expectedTables", () => {
  it("reads every declared table from the drizzle schema", () => {
    const names = expectedTables().map((t) => t.name);
    expect(names).toContain("daily_metrics");
    expect(names).toContain("indexer_state");
    expect(names).toContain("backfill_checkpoint");
    expect(names).toEqual([...names].sort());
  });

  it("marks composite primary-key members as NOT NULL", () => {
    const daily = expectedTables().find((t) => t.name === "daily_metrics")!;
    const day = daily.columns.find((c) => c.name === "day")!;
    expect(day).toMatchObject({ primaryKey: true, notNull: true });
  });
});

describe("diffSchema", () => {
  const expected: ExpectedTable[] = [
    { name: "t1", columns: [{ name: "a", notNull: true, primaryKey: true }, { name: "b", notNull: false, primaryKey: false }] },
  ];

  it("reports nothing when the database matches", () => {
    expect(diffSchema(expected, liveFor(expected))).toEqual([]);
  });

  it("reports a missing table without also reporting each of its columns", () => {
    expect(diffSchema(expected, [])).toEqual([{ kind: "missing-table", table: "t1" }]);
  });

  it("reports a missing column", () => {
    const live = liveFor(expected).filter((c) => c.column !== "b");
    expect(diffSchema(expected, live)).toEqual([{ kind: "missing-column", table: "t1", column: "b" }]);
  });

  it("reports nullability drift in both directions", () => {
    const relaxed = liveFor(expected).map((c) => (c.column === "a" ? { ...c, isNullable: true } : c));
    expect(diffSchema(expected, relaxed)).toEqual([{ kind: "nullability", table: "t1", column: "a", expectedNotNull: true }]);

    const tightened = liveFor(expected).map((c) => (c.column === "b" ? { ...c, isNullable: false } : c));
    expect(diffSchema(expected, tightened)).toEqual([{ kind: "nullability", table: "t1", column: "b", expectedNotNull: false }]);
  });

  it("ignores extra tables and extra columns, which a deploy must never drop", () => {
    const live = [...liveFor(expected), { table: "t1", column: "extra", isNullable: true }, { table: "other", column: "x", isNullable: true }];
    expect(diffSchema(expected, live)).toEqual([]);
  });

  it("describes each problem in a line an operator can act on", () => {
    expect(describeProblem({ kind: "missing-table", table: "t1" })).toBe("table t1 is missing");
    expect(describeProblem({ kind: "missing-column", table: "t1", column: "b" })).toBe("t1.b is missing");
    expect(describeProblem({ kind: "nullability", table: "t1", column: "a", expectedNotNull: true })).toBe(
      "t1.a should be NOT NULL and is not"
    );
  });
});
