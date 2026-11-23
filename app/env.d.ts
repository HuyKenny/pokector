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
  /** eBay Developer keyset (Browse API live prices). Both absent → the eBay
   * price lookup is disabled and the card page just shows the affiliate button. */
  EBAY_APP_ID?: string;
  EBAY_CERT_ID?: string;
  /** Shared token for the eBay Marketplace Account Deletion endpoint challenge. */
  EBAY_VERIFICATION_TOKEN?: string;
  /** Autumn secret key (am_sk_…) — billing lives on Autumn, which drives Stripe
   * underneath. Absent → billing is disabled: the pricing page still renders but
   * checkout/portal are unavailable (honest degraded mode). */
  AUTUMN_SECRET_KEY?: string;
  /** Svix signing secret (whsec_…) for /api/autumn/webhook. Absent → the webhook
   * fail-closes with 503: an unverified billing webhook is a way to grant
   * yourself a paid plan. */
  AUTUMN_WEBHOOK_SECRET?: string;
  /** JustTCG API key (x-api-key) for the Riftbound catalog + prices sync. Absent
   * → the Riftbound sync is disabled (the /riftbound catalog stays empty). */
  JUSTTCG_API_KEY?: string;
  /** "1" only in the `static` build (scripts/static/build.sh): the local runner
   * drives the job chain itself (no queue, no waiting for runAfter). */
  STATIC_RUNNER?: string;
}

// Newer `wrangler types` no longer derives the global Env from Cloudflare.Env, so
// `env` from "cloudflare:test" / "cloudflare:workers" (typed Cloudflare.Env) would
// miss the secrets above. Fold them in so both names describe the same bindings.
type AppEnv = Env;
declare namespace Cloudflare {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- merge-only
  interface Env extends AppEnv {}
}
