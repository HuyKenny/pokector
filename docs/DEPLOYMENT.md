# Pokector — Deployment

Last updated: 2026-07-17 (Phase 0 — plan; statuses updated in Phase 10)

## Environments & resources

| Resource | Staging                  | Production                  |
| -------- | ------------------------ | --------------------------- |
| Worker   | `pokector-staging`       | `pokector-production`       |
| D1       | `pokector-staging`       | `pokector-production`       |
| KV       | `pokector-cache-staging` | `pokector-cache-production` |
| URL      | workers.dev (noindex)    | `https://pokector.com`      |
| Crons    | none (manual triggers)   | `17 5 * * *` |

Account: huy.kenny@gmail.com (`7dcd021a0f64e56889505c60c878f3ab`), zone
`pokector.com` (`37a0953c5759fbbff63b2da27250b099`, Free plan).

## Order (per SPEC §28)

1. Local build + tests green
2. Local D1 migrations applied
3. Create staging D1/KV → IDs into `wrangler.jsonc` env.staging
4. `pnpm wrangler d1 migrations apply pokector-staging --env staging --remote`
5. `pnpm wrangler deploy --env staging`
6. Staging catalog: controlled real sync (small batch) or fixtures
7. Staging smoke tests (see checklist below)
8. Create production D1/KV → IDs into env.production
9. Production migrations (`--env production --remote`)
10. Production secrets (`wrangler secret put … --env production`) + verify list
11. `pnpm wrangler deploy --env production`
12. `/health` check on workers.dev URL
13. Domain attach (below)
14. Production smoke tests

## Domain attachment (owner approved replacing parking DNS)

Current state (verified 2026-07-16): A/AAAA records for apex, `www`, and `*` point to
WEDOS parking (185.8.237.22 / 2a0e:acc0::d22), proxied. Zone is otherwise unused.

1. Delete parking A/AAAA records for `pokector.com` apex (CF API, global key).
2. Add custom domain route in `wrangler.jsonc` production env:
   `{ "pattern": "pokector.com", "custom_domain": true }` → deploy (auto-creates DNS + cert).
3. `www`: replace parking records with placeholder proxied `A 192.0.2.0` / `AAAA 100::`
   and create a zone Redirect Rule `www.pokector.com/* → https://pokector.com/$1` (301)
   — current CF-recommended pattern.
4. Delete wildcard `*.pokector.com` parking records (owner approved; no subdomains in use).
5. Verify: HTTPS, www→apex 301, HTTP→HTTPS, robots.txt, sitemap.xml, auth cookies,
   Turnstile, card images, no secret in client bundle.

Rollback: parking record values documented above — recreate A/AAAA to restore.

## Automated deploy pipeline (2026-07-17 — CI/CD)

Deploys are no longer run by hand. `.github/workflows/deploy.yml` triggers
automatically after `.github/workflows/ci.yml` (lint/typecheck/tests/build) passes on
`main`, and runs in order:

1. D1 migrations + deploy to **staging**
2. `scripts/smoke-live.mjs` against staging (images load, filters hydrate, no console
   errors — see script header for exactly what it checks)
3. D1 migrations + deploy to **production**
4. `scripts/smoke-live.mjs` against `https://pokector.com`
5. If the production smoke test fails, the job **auto-rolls back**
   (`wrangler rollback --env production`) so a broken deploy never stays live
   unattended, and the GitHub Actions run shows red (Kenny gets the failure
   notification from GitHub).

So the workflow going forward is just: **push to `main`, everything else happens on
its own.** The commands below remain for local/manual use (debugging a failed deploy,
one-off migrations, etc.) — they're the same commands CI runs.

```bash
source scripts/env.sh                      # Node 22 + pnpm on PATH (Raspberry Pi)
pnpm install
pnpm dev                                   # local dev (vite + workerd)
pnpm db:migrate:staging                    # remote D1 migrations (staging)
pnpm deploy:staging                        # CLOUDFLARE_ENV=staging build + deploy
pnpm db:migrate:production
pnpm deploy:production                     # CLOUDFLARE_ENV=production build + deploy
pnpm admin:grant --email user@example.com  # first admin (confirms interactively)

# Headless-browser check of hydration + CSP (dev runs 'unsafe-inline', so only
# deployed envs exercise the nonce-based CSP; a missing nonce on RR's streamed
# scripts kills ALL client interactivity while every server-rendered page still
# looks fine). CI runs this automatically after every deploy; only needed by hand
# when debugging outside the pipeline.
pnpm smoke https://pokector.com
```

Note (verified 2026-07-17): with `@cloudflare/vite-plugin`, the target environment is
selected at BUILD time via `CLOUDFLARE_ENV` — the build emits a resolved
`build/server/wrangler.json` (plus a `.wrangler/deploy/config.json` redirect), so
`wrangler deploy` runs without `--env`. Passing only `--env` to deploy would ship the
previously built environment.

### One-time CI setup (owner action, not yet done)

The pipeline needs a GitHub repo + one secret before it can run:

1. Create a GitHub repo and push this repo to it (`git remote add origin …` + push
   `main`).
2. Cloudflare dashboard → My Profile → API Tokens → Create Token → custom token with:
   `Account.Workers Scripts:Edit`, `Account.Workers KV Storage:Edit`,
   `Account.D1:Edit`, `Account.Workers Queues:Edit`, `Account.Workers Tail:Read`,
   `User.Memberships:Read`, `Zone.Workers Routes:Edit` (zone = pokector.com) — or
   simpler, the built-in **"Edit Cloudflare Workers"** template covers Workers/KV/D1;
   add D1 + Queues edit permissions to it manually since the template predates them.
3. Repo → Settings → Secrets and variables → Actions → New repository secret:
   `CLOUDFLARE_API_TOKEN` = the token from step 2.
4. Push to `main` — the first run does everything above by itself.

Nothing else needs to be a secret: `CLOUDFLARE_ACCOUNT_ID` isn't sensitive and is
hardcoded in `deploy.yml`; app secrets (`POKEMON_TCG_API_KEY`,
`BETTER_AUTH_SECRET`, `TURNSTILE_SECRET_KEY`) already live as Worker secrets in
Cloudflare (set once via `wrangler secret put`) and CI never needs to touch them.

## Post-launch (owner actions, optional)

- Create `info@pokector.com` via Cloudflare Email Routing → forward to owner inbox
  (zone → Email → Email Routing; free). Until then the address only receives via
  routing — do not publish before enabling.
- Rotate `POKEMON_TCG_API_KEY` at dev.pokemontcg.io, then re-run
  `wrangler secret put POKEMON_TCG_API_KEY --env production`.
- Optional: `RESEND_API_KEY` to enable verification/reset/alert e-mails;
  `GOOGLE_CLIENT_ID/SECRET` to enable Google OAuth.
- GitHub remote + repo secrets if CI deploys are wanted (workflows are included).

## Status (2026-07-17)

- [x] Staging deployed — https://pokector-staging.huy-kenny.workers.dev
- [x] Staging smoke tests passed
- [x] Production deployed — https://pokector-production.huy-kenny.workers.dev
- [x] Domain attached — https://pokector.com + www→apex (parking DNS replaced)
- [x] Production smoke tests passed
- [x] Turnstile production widget provisioned (sitekey 0x4AAAAAAD33n0rHJcspIYG9)

Rollback (if ever needed): recreate proxied A pokector.com/www → 185.8.237.22 and
AAAA → 2a0e:acc0::d22 (original WEDOS parking), remove custom-domain routes.
