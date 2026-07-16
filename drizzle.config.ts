import { defineConfig } from "drizzle-kit";

/**
 * Migration generation only (`pnpm db:generate`). Migrations are applied with
 * `wrangler d1 migrations apply` (local/staging/production) — see package.json.
 */
export default defineConfig({
  schema: "./app/lib/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "sqlite",
});
