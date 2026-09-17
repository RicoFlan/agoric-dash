import { describe, expect, it } from "vitest";
import { ADDITIVE_TABLE_NAMES } from "@/db/ensureAdditiveTables";
import { expectedTables } from "@/db/schemaExpectations";

/**
 * Guards the failure that prompted this list: a table declared in the drizzle schema but created
 * only lazily at runtime. The deploy-time check verifies everything the schema declares, so such a
 * table fails a fresh deployment before anything has had the chance to create it.
 */
describe("additive tables", () => {
  it("names only tables the schema actually declares", () => {
    const declared = new Set(expectedTables().map((t) => t.name));
    for (const name of ADDITIVE_TABLE_NAMES) expect(declared).toContain(name);
  });

  it("covers the lazily created price table, not just the ones with a create helper nearby", () => {
    expect(ADDITIVE_TABLE_NAMES).toContain("denom_price_day");
  });

  it("lists each table once", () => {
    expect(new Set(ADDITIVE_TABLE_NAMES).size).toBe(ADDITIVE_TABLE_NAMES.length);
  });
});
