/**
 * The schema the application expects, derived from `src/db/schema.ts` itself.
 *
 * This exists so a deploy can *verify* the live database instead of mutating it. `drizzle-kit push`
 * is a development convenience: it diffs and then issues ALTER/DROP statements, which is exactly
 * what you do not want running unattended against production data. Worse, on PostgreSQL 17+ it
 * misreads the new named NOT NULL constraints as unwanted extras and tries to drop every one of
 * them, and the npm wrapper reports success even when that fails.
 *
 * So the deploy path creates missing additive tables and then checks. Anything else that has
 * drifted is reported and fails the deploy loudly, rather than being silently altered or silently
 * ignored.
 */
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

export interface ExpectedColumn {
  name: string;
  notNull: boolean;
  primaryKey: boolean;
}

export interface ExpectedTable {
  name: string;
  columns: ExpectedColumn[];
}

function isPgTable(v: unknown): v is PgTable {
  return typeof v === "object" && v !== null && "getSQL" in (v as Record<string, unknown>);
}

/** Every table the application declares, with the column facts a check can verify portably. */
export function expectedTables(): ExpectedTable[] {
  const out: ExpectedTable[] = [];
  for (const value of Object.values(schema)) {
    if (!isPgTable(value)) continue;
    const cfg = getTableConfig(value);
    // A column is part of the key either inline (.primaryKey()) or via a composite primaryKey({...}).
    const composite = new Set<string>();
    for (const pk of cfg.primaryKeys) for (const c of pk.columns) composite.add(c.name);
    out.push({
      name: cfg.name,
      columns: cfg.columns.map((c) => ({
        name: c.name,
        notNull: c.notNull || c.primary || composite.has(c.name),
        primaryKey: c.primary || composite.has(c.name),
      })),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface LiveColumn {
  table: string;
  column: string;
  isNullable: boolean;
}

export type SchemaProblem =
  | { kind: "missing-table"; table: string }
  | { kind: "missing-column"; table: string; column: string }
  | { kind: "nullability"; table: string; column: string; expectedNotNull: boolean };

/**
 * Compare expectations against the live columns. Extra tables and extra columns are NOT problems:
 * the database may legitimately carry more than this application declares, and a deploy has no
 * business dropping them.
 */
export function diffSchema(expected: ExpectedTable[], live: LiveColumn[]): SchemaProblem[] {
  const byTable = new Map<string, Map<string, LiveColumn>>();
  for (const c of live) {
    let t = byTable.get(c.table);
    if (!t) byTable.set(c.table, (t = new Map()));
    t.set(c.column, c);
  }
  const problems: SchemaProblem[] = [];
  for (const table of expected) {
    const liveCols = byTable.get(table.name);
    if (!liveCols) {
      problems.push({ kind: "missing-table", table: table.name });
      continue;
    }
    for (const col of table.columns) {
      const lc = liveCols.get(col.name);
      if (!lc) {
        problems.push({ kind: "missing-column", table: table.name, column: col.name });
        continue;
      }
      if (col.notNull === lc.isNullable) {
        problems.push({ kind: "nullability", table: table.name, column: col.name, expectedNotNull: col.notNull });
      }
    }
  }
  return problems;
}

export function describeProblem(p: SchemaProblem): string {
  switch (p.kind) {
    case "missing-table":
      return `table ${p.table} is missing`;
    case "missing-column":
      return `${p.table}.${p.column} is missing`;
    case "nullability":
      return `${p.table}.${p.column} should be ${p.expectedNotNull ? "NOT NULL" : "nullable"} and is not`;
  }
}
