import { describe, expect, it } from "vitest";
import { dashboardNavLinks, dashboardSectionIds } from "@/lib/dashboardNav";

describe("dashboardNav", () => {
  it("has unique section ids and matching nav hrefs", () => {
    const ids = Object.values(dashboardSectionIds);
    expect(new Set(ids).size).toBe(ids.length);

    for (const { id, label } of dashboardNavLinks) {
      expect(label.trim().length).toBeGreaterThan(0);
      expect(ids).toContain(id);
      expect(`#${id}`).toMatch(/^#[a-z0-9-]+$/);
    }
  });

  it("omits filters from nav; every link id is a section anchor", () => {
    const navIds = new Set(dashboardNavLinks.map((l) => l.id));
    expect(navIds.has(dashboardSectionIds.filters)).toBe(false);
    for (const id of navIds) {
      expect(Object.values(dashboardSectionIds)).toContain(id);
    }
    expect(dashboardNavLinks.length).toBe(Object.keys(dashboardSectionIds).length - 1);
  });
});
