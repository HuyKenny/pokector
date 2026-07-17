import path from "node:path";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "drizzle", "migrations"));

  return {
    test: {
      projects: [
        {
          test: {
            name: "unit",
            include: ["test/unit/**/*.test.ts", "app/**/*.test.ts"],
            environment: "node",
          },
          resolve: { alias: { "~": path.resolve(__dirname, "app") } },
        },
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: "./wrangler.jsonc" },
              miniflare: {
                bindings: {
                  TEST_MIGRATIONS: migrations,
                  // Test-only value — never a real secret.
                  BETTER_AUTH_SECRET: "vitest-only-secret-not-used-anywhere-else",
                },
              },
            }),
          ],
          test: {
            name: "integration",
            include: ["test/integration/**/*.test.ts"],
            setupFiles: ["./test/apply-migrations.ts"],
          },
          resolve: { alias: { "~": path.resolve(__dirname, "app") } },
        },
      ],
    },
  };
});
