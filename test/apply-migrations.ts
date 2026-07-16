import { applyD1Migrations, env } from "cloudflare:test";

// Setup files may run repeatedly; applyD1Migrations is idempotent.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
