import { expect, test } from "@playwright/test";

import { expectSignedIn, registerUser } from "./helpers";

test.describe("authenticated flows", () => {
  test("register → onboarding → dashboard empty state", async ({ page }) => {
    await registerUser(page, "reg");
    // New users land on onboarding.
    await expect(page).toHaveURL(/\/app\/onboarding/);
    await page.getByRole("button", { name: /dashboard/i }).click();
    await page.waitForURL(/\/app$/);
    await expect(page.getByText(/portfolio starts here/i)).toBeVisible();
  });

  test("add a card to the collection and see portfolio value", async ({ page }) => {
    await registerUser(page, "collect");
    await page.goto("/cards/base1-4-charizard");
    await page.getByRole("button", { name: /add to collection/i }).click();
    await page.goto("/app/collection");
    await expect(page.getByText("Charizard").first()).toBeVisible();

    await page.goto("/app");
    await expect(page.getByText("Estimated market value")).toBeVisible();
    // Portfolio shows a real USD total once a priced card is added.
    await expect(page.getByText(/\$\d[\d,]*\.\d{2}/).first()).toBeVisible();
  });

  test("collection requires auth (guarded)", async ({ page }) => {
    await page.goto("/app/collection");
    await expect(page).toHaveURL(/\/login/);
  });

  test("logout returns to home and re-guards the app", async ({ page }) => {
    await registerUser(page, "logout");
    await expectSignedIn(page);
    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL(/\/$/);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });

  test("user data isolation: cannot open a foreign binder id", async ({ page }) => {
    await registerUser(page, "iso");
    // A random/foreign binder ID must 404 (not reveal another user's data).
    const res = await page.goto("/app/binders/00000000-0000-4000-8000-000000000000");
    expect(res?.status()).toBe(404);
  });
});
