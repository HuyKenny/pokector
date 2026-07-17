# Pokector — Deployment

Last updated: 2026-07-17 (Phase 0 — plan; statuses updated in Phase 10)

## Environments & resources

| Resource | Staging                  | Production                  |
| -------- | ------------------------ | --------------------------- |
| Worker   | `pokector-staging`       | `pokector-production`       |
| D1       | `pokector-staging`       | `pokector-production`       |
| KV       | `pokector-cache-staging` | `pokector-cache-production` |
| URL      | workers.dev (noindex)    | `https://pokector.com`      |
| Crons    | none (manual triggers)   | `*/5 * * * *`, `17 5 * * *` |

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

## Commands

```bash
source scripts/env.sh                      # Node 22 + pnpm on PATH (Raspberry Pi)
pnpm install
pnpm dev                                   # local dev (vite + workerd)
pnpm db:migrate:staging                    # remote D1 migrations (staging)
pnpm deploy:staging                        # CLOUDFLARE_ENV=staging build + deploy
pnpm db:migrate:production
pnpm deploy:production                     # CLOUDFLARE_ENV=production build + deploy
pnpm admin:grant --email user@example.com  # first admin (confirms interactively)

# MANDATORY after every staging/production deploy — headless-browser check of
# hydration + CSP (dev runs 'unsafe-inline', so only deployed envs exercise the
# nonce-based CSP; a missing nonce on RR's streamed scripts kills ALL client
# interactivity while every server-rendered page still looks fine):
cd ~/ai && node pokector/scripts/smoke-live.mjs https://pokector.com
```

Note (verified 2026-07-17): with `@cloudflare/vite-plugin`, the target environment is
selected at BUILD time via `CLOUDFLARE_ENV` — the build emits a resolved
`build/server/wrangler.json` (plus a `.wrangler/deploy/config.json` redirect), so
`wrangler deploy` runs without `--env`. Passing only `--env` to deploy would ship the
previously built environment.

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
