// Worker secrets (set via `wrangler secret put` / .dev.vars — see docs/SECRETS.md).
// They are not part of wrangler.jsonc `vars`, so the generated Env interface in
// worker-configuration.d.ts does not know them; this ambient declaration merges
// them in. Optional members may legitimately be absent at runtime (degraded modes).
interface Env {
  /** Required for auth to operate; getAuth() fails fast when missing. */
  BETTER_AUTH_SECRET: string;
  /** Absent → real catalog sync disabled, fixtures/dev mode (SPEC §4). */
  POKEMON_TCG_API_KEY?: string;
  /** Absent → Turnstile verification cannot run; auth forms are blocked in prod. */
  TURNSTILE_SECRET_KEY?: string;
  /** Absent → honest degraded e-mail mode (no verification/reset/alert e-mails). */
  RESEND_API_KEY?: string;
  /** Both absent → Google OAuth hidden. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** "true" only in local development/E2E — skips the Turnstile gate. Never set
   * in staging/production, so captcha is always enforced there. */
  CAPTCHA_DISABLED?: string;
}
