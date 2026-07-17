import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { registerUser } from "./helpers";

/** WCAG 2.2 AA-oriented checks on key public + authenticated pages (SPEC §26). */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function scan(page: Page) {
  return new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
}

test.describe("accessibility (axe-core)", () => {
  for (const path of ["/", "/cards", "/cards/base1-4-charizard", "/login", "/register"]) {
    test(`no serious/critical violations: ${path}`, async ({ page }) => {
      await page.goto(path);
      const results = await scan(page);
      const serious = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(
        serious,
        JSON.stringify(
          serious.map((v) => ({ id: v.id, nodes: v.nodes.length })),
          null,
          2,
        ),
      ).toEqual([]);
    });
  }

  test("dashboard + collection form are accessible", async ({ page }) => {
    await registerUser(page, "a11y");
    for (const path of ["/app", "/app/collection"]) {
      await page.goto(path);
      const results = await scan(page);
      const serious = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(serious, `${path}: ${JSON.stringify(serious.map((v) => v.id))}`).toEqual([]);
    }
  });
});
