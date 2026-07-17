import { expect, test } from "@playwright/test";

test.describe("public site", () => {
  test("homepage renders with hero, search, and trademark disclaimer", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/collection/i);
    await expect(page.getByRole("searchbox").first()).toBeVisible();
    await expect(page.getByText(/not affiliated with/i)).toBeVisible();
  });

  test("catalog search finds a seeded card", async ({ page }) => {
    await page.goto("/cards?q=charizard");
    await expect(page.getByRole("link", { name: /Charizard/ }).first()).toBeVisible();
  });

  test("card page shows price and disclaimer", async ({ page }) => {
    await page.goto("/cards/base1-4-charizard");
    await expect(page.getByRole("heading", { name: "Charizard" })).toBeVisible();
    await expect(page.getByText("Current market prices (USD)")).toBeVisible();
    // A real USD amount is shown (exact value depends on synced data).
    await expect(page.getByText(/\$\d[\d,]*\.\d{2}/).first()).toBeVisible();
    await expect(page.getByText(/estimated market price/i)).toBeVisible();
  });

  test("mobile navigation works", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Cards" }).first().click();
    await expect(page).toHaveURL(/\/cards/);
  });

  test("dark mode toggles via prefers-color-scheme", async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: "dark" });
    const page = await ctx.newPage();
    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await ctx.close();
  });

  test("404 for unknown page", async ({ page }) => {
    const res = await page.goto("/no-such-page");
    expect(res?.status()).toBe(404);
    await expect(page.getByText(/page not found/i)).toBeVisible();
  });
});
