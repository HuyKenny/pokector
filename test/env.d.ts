// Test-only binding provided via vitest.config.ts miniflare.bindings.
// `env` from "cloudflare:test" is typed as Cloudflare.Env (see generated
// worker-configuration.d.ts), so we augment that namespace here. Ambient
// namespaces cannot use top-level imports, hence the import() type.
/* eslint-disable @typescript-eslint/consistent-type-imports */
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
