import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contract tests: the read-time module-account exclusion (M1 policy) stays wired into
 * `participationQueries.ts`, and the participation policy doc-comment reflects the v1 policy.
 *
 * Source-text inspection only — `participationQueries.ts` itself requires a Postgres connection
 * and is not unit-testable here. See `agoricModuleAccounts.contract.test.ts` for the underlying
 * blocklist guarantees.
 */
describe("participation read-time module-account filter", () => {
  const queriesSrc = readFileSync(
    join(__dirname, "participationQueries.ts"),
    "utf8"
  );
  const policySrc = readFileSync(
    join(__dirname, "participantRollupPolicy.ts"),
    "utf8"
  );

  it("participationQueries imports the module-account blocklist", () => {
    expect(queriesSrc).toMatch(
      /from\s+"@\/lib\/agoricModuleAccounts"/
    );
    expect(queriesSrc).toContain("AGORIC_MODULE_ACCOUNT_ADDRESSES");
  });

  it("participationQueries applies the exclusion in every range query", () => {
    expect(
      (queriesSrc.match(/notInArray\(participantDay\.address/g) ?? []).length
    ).toBeGreaterThanOrEqual(2);
    expect(queriesSrc).toContain(
      "notInArray(addressVolumeDay.address"
    );
    expect(
      (queriesSrc.match(/address\s*<>\s*ALL\(\$3::text\[\]\)/g) ?? []).length
    ).toBeGreaterThanOrEqual(2);
  });

  it("participation policy doc-comment no longer asserts a blanket no-exclusion stance", () => {
    expect(policySrc).not.toMatch(/no exclusion list/i);
    expect(policySrc).toMatch(/AGORIC_MODULE_ACCOUNT_ADDRESSES/);
  });
});
