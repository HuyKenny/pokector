# Pokector — Secrets & Configuration

Never commit real secret values. Real values live only in:

- Cloudflare Worker secrets (`wrangler secret put NAME --env <staging|production>`)
- Local `.dev.vars` (gitignored)
- Owner's workspace credentials store (`~/ai/credentials/.pokector-credentials.env`, outside this repo)

## Required secrets

| Name                   | Purpose                            | Status                                                                                                      | How to set                                                  |
| ---------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `POKEMON_TCG_API_KEY`  | PTCG API `X-Api-Key` (server-only) | provided by owner 2026-07-16 (stored in workspace credentials; **rotate after launch** — it transited chat) | `wrangler secret put POKEMON_TCG_API_KEY --env production`  |
| `BETTER_AUTH_SECRET`   | Better Auth signing secret         | generate per env: `openssl rand -base64 32`                                                                 | `wrangler secret put BETTER_AUTH_SECRET --env production`   |
| `TURNSTILE_SECRET_KEY` | Turnstile siteverify               | provisioned via CF API during deployment (per-env widget)                                                   | `wrangler secret put TURNSTILE_SECRET_KEY --env production` |

## Optional secrets

| Name                                        | Purpose                              | Status                                                        |
| ------------------------------------------- | ------------------------------------ | ------------------------------------------------------------- |
| `RESEND_API_KEY`                            | e-mail (verification, reset, alerts) | **not configured** → honest degraded mode (see DECISIONS D10) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth                         | **not configured** → provider hidden                          |
| `STRIPE_SECRET_KEY`                         | Stripe API (Checkout, Portal, subscription reads) | TEST in staging, LIVE in production. Absent → billing disabled (pricing page renders, checkout/portal off). **Never paste in chat/code — set via `wrangler secret put`.** |
| `STRIPE_WEBHOOK_SECRET`                     | `/api/stripe/webhook` signature verify (`whsec_…`) | one per env (from the Stripe webhook endpoint). Absent → webhook fail-closed. |

## Non-secret environment variables (wrangler.jsonc `vars`, per environment)

| Name                     | Production value                             |
| ------------------------ | -------------------------------------------- |
| `APP_NAME`               | `Pokector`                                   |
| `APP_URL`                | `https://pokector.com`                       |
| `ENVIRONMENT`            | `production` / `staging` / `development`     |
| `DEFAULT_CURRENCY`       | `USD`                                        |
| `DEFAULT_LOCALE`         | `en-US`                                      |
| `TURNSTILE_SITE_KEY`     | per-env widget sitekey (public, not secret)  |
| `SUPPORT_EMAIL`          | `info@pokector.com`                          |
| `LEGAL_OPERATOR_NAME`    | `Ha Duy Huy`                                 |
| `LEGAL_CONTACT_EMAIL`    | `info@pokector.com`                          |
| `LEGAL_OPERATOR_ADDRESS` | `Bartáková 36, 140 00 Praha, Czech Republic` |
| `LEGAL_OPERATOR_ID`      | `IČO 07876823`                               |
| `STRIPE_PRICE_MONTHLY`   | Stripe recurring Price ID, monthly (public, per-env TEST/LIVE) |
| `STRIPE_PRICE_YEARLY`    | Stripe recurring Price ID, yearly (public, per-env TEST/LIVE)  |

> **Stripe setup**: create a "Pokector Pro" Product in Stripe with a monthly and a
> yearly recurring Price; put the Price IDs in the `wrangler.jsonc` `vars` (test IDs
> in dev/staging, live IDs in production, replacing the `price_*_replace_me_*`
> placeholders). Set `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` as secrets. Add a
> webhook endpoint `https://<host>/api/stripe/webhook` subscribed to
> `checkout.session.completed`, `customer.subscription.updated`,
> `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.

## Local development

Copy `.dev.vars.example` → `.dev.vars` and fill values. Tests use fixtures and
Turnstile official test keys — no real secrets required to develop or run tests.

## Rules

- If `POKEMON_TCG_API_KEY` is absent in an environment: real sync is disabled, the
  admin dashboard shows a warning with the exact `wrangler secret put` command, and
  fixtures keep local dev/tests working. No fake key is ever placed anywhere.
- Secrets are never echoed after entry, never logged, never in error messages, never
  in client bundles (deploy check greps build output).
