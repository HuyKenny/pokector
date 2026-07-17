import { defineConfig, devices } from "@playwright/test";

/**
 * E2E + accessibility tests run against the built app served by `wrangler dev`
 * with local D1/KV. A global setup seeds a deterministic catalog + admin user.
 */
const PORT = 5273;

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // Vite dev server (SSR) with local bindings — seeded by global setup.
    command: `PORT=${PORT} pnpm exec react-router dev --port ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
  globalSetup: "./test/e2e/global-setup.ts",
});
