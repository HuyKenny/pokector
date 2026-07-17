import { expect, type Page } from "@playwright/test";

/** Register a fresh user (Turnstile test keys auto-pass). Returns the email. */
export async function registerUser(page: Page, suffix: string): Promise<string> {
  const email = `e2e-${suffix}-${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Display name").fill(`E2E ${suffix}`);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("e2e-password-123");
  await page.getByLabel("Confirm password").fill("e2e-password-123");
  // Turnstile test widget auto-passes; wait for the token then submit.
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 20_000 });
  return email;
}

export async function expectSignedIn(page: Page) {
  await expect(page.getByRole("link", { name: /dashboard/i }).first()).toBeVisible();
}
