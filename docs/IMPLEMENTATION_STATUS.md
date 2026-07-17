# Pokector — Implementation Status

> Living checklist. Update after every phase. Do not mark items complete until
> implemented AND verified. Spec contract: [SPEC.md](SPEC.md).

Last updated: 2026-07-17 (Phase 2 complete)

## Phase 0 — Inspection, docs, plan

- [x] Repository inspection (workspace `~/ai`, project lives in own git repo `~/ai/pokector`)
- [x] Node.js: system v20.20.2 (EOL) → installed user-local Node v22.23.1 LTS at `~/.local/node/` (see DECISIONS #7)
- [x] Package manager: pnpm 11.13.1 via corepack (Node 22)
- [x] Cloudflare MCP: not connected → wrangler + CF REST API instead
- [x] Wrangler auth: OAuth, account `huy.kenny@gmail.com` (7dcd021a0f64e56889505c60c878f3ab)
- [x] Zone pokector.com exists in account (Free plan, zone 37a0953c5759fbbff63b2da27250b099); currently WEDOS parking DNS (A/AAAA apex+www+wildcard → 185.8.237.22). Owner approved replacing parking records at domain-attach time.
- [x] No existing Pokector resources; unrelated resources identified (4 workers, KV `REDIRECTS`) — will not touch
- [x] Cloudflare Queues unavailable (Free plan) → D1-backed job queue fallback (spec-compliant)
- [x] Pokémon TCG API reachable (~20,359 cards); API key obtained from owner, stored outside repo
- [x] docs/ created (SPEC, IMPLEMENTATION_STATUS, ARCHITECTURE, DECISIONS, SECURITY, DEPLOYMENT, COST_AND_SCALING, DATA_METHODOLOGY, SECRETS)
- [x] Official docs verification: Better Auth 1.6.23 (adapter pkg, CLI, scrypt-on-Workers caveat, captcha/Turnstile plugin, KV secondaryStorage)
- [x] Official docs verification: CF free-plan limits (retrieved 2026-07-16/17, see COST_AND_SCALING.md), wrangler.jsonc env inheritance (bindings/vars NOT inherited; triggers/routes inherited), Queues now on Free (10k ops/day → D4), cron 5/account, vitest `cloudflareTest()` API, Turnstile widget API + test keys

## Phase 1 — Scaffold, config, CI, brand

- [x] React Router v8 + Cloudflare scaffold, upgraded to RR 8.2.0 (RouterContextProvider load context)
- [x] TypeScript strict configuration verified (scaffold tsconfigs, `tsc -b` green)
- [x] Tailwind 4 design tokens (semantic light/dark palette, focus styles, skeletons)
- [x] wrangler.jsonc: staging + production envs with real resource IDs (D1/KV/Queues created), observability, nodejs_compat, crons (2 prod / 0 staging)
- [x] Worker entry: fetch (security headers + request ID + structured logs) + scheduled + queue handlers
- [x] ESLint (typed, no-floating-promises/no-explicit-any) + Prettier — clean
- [x] `wrangler types` generated bindings (worker-configuration.d.ts, regenerated in typecheck)
- [x] CI (GitHub Actions: lint/format/typecheck/tests/build/dry-run), dependabot, PR+issue templates
- [x] Brand: original icon (binder grid + trend line) SVG + PNG 192/512, manifest, favicon; wordmark component. Social OG image → Phase 5
- [x] Deploy mechanics verified: CLOUDFLARE_ENV selects env at build; `pnpm deploy:dry-run` green (723 KiB / 154 KiB gzip)
- [x] Dev SSR smoke test: 200, CSP + X-Request-Id headers present

## Phase 2 — Database

- [x] Drizzle schema: 24 tables — Better Auth core (generated via `auth generate` CLI, admin plugin fields) + all SPEC §19 tables + `sync_runs` bookkeeping; 46 indexes incl. all spec hot paths
- [x] Migration `0000_known_human_torch.sql` generated (drizzle-kit) + applied to local D1 (71 statements)
- [x] DB factory `createDb` (per-request drizzle over D1) + slug/normalization helpers
- [x] Seed fixtures: real PTCG API snapshots (173 sets, 102 base1 + 60 sv1 cards incl. TCGplayer/Cardmarket price blocks) via scripts/fetch-fixtures.mjs
- [x] Test infra: vitest projects (unit + integration via `cloudflareTest()` with D1 migrations in setup); 11 unit + 3 integration tests green (unique constraints verified)
- Note: feature repositories land with their phases (catalog→P4, collection/portfolio→P6, …) on top of createDb

## Phase 3 — Auth & security foundation

- [x] Better Auth per-request factory: email+password, sessions in KV (secondaryStorage), secure pokector.* cookies, cf-connecting-ip, trustedOrigins
- [x] Native scrypt (node:crypto) hashing with format versioning + unit tests (CPU-limit workaround, DECISIONS D6)
- [x] Roles via admin plugin; profile row auto-created on signup (databaseHooks); `pnpm admin:grant` CLI (confirmation + audit event + local/staging/production, --allow-unverified documented)
- [x] Turnstile: captcha plugin on sign-up/sign-in/reset endpoints, accessible widget component, official test keys in dev; real widgets provisioned in Phase 10
- [x] Security headers on every response (CSP w/ theme-script hash + Turnstile origins, HSTS prod, XCTO, Referrer-Policy, Permissions-Policy, frame protection) — from Phase 1, verified in smoke test
- [x] Rate limiting: Better Auth built-in (KV storage, per-endpoint custom rules) + KV fixed-window limiter for search/import/export/alerts/admin (used by later phases)
- [x] Routes: /login /register /forgot-password /reset-password /logout(POST) /app layout (guard + noindex + no-store) /app/onboarding /app/settings (profile+theme, change password w/ session revocation, account deletion w/ password re-auth)
- [x] Honest degraded e-mail mode (no Resend key): reset form shows unavailable state; provider abstraction in app/lib/email/
- [x] Verified: 16 unit + 6 integration tests green; dev smoke test — signup 200+cookie, /app guard 302, wrong password 401, missing captcha 400

## Phase 4 — Catalog sync

- [x] Typed PTCG client: timeout, retries w/ backoff+jitter, 429/Retry-After, zod validation, request counting + 15k/day budget guard (KV), injectable fetch for tests; pageSize 50 → each page fits the Free-plan 10 ms CPU budget (DECISIONS D14)
- [x] Decimal→minor-units parser (BigInt string math, half-up; 15 unit tests incl. float traps)
- [x] Price normalization: TCGplayer market→mid→low per variant (incl. 1stEdition* mapping), Cardmarket EUR trend→avgSell→low kept separate; missing price = no row (never zero)
- [x] Sync: catalog_sets → catalog_cards_page fan-out (idempotency keys per run+page), chunked db.batch upserts, malformed-record skip+count, sync_runs bookkeeping, complete only when all pages succeed, inactive-marking after absence from 2 completed runs
- [x] D1 job queue: lease-based claim (UPDATE…RETURNING), retry w/ exponential backoff, dead-letter, abandoned-job recovery, idempotency keys; ONE job per invocation + queue wake-up chaining (fresh CPU budget each); cron */5 fallback + daily orchestrator (05:17 UTC)
- [x] Price history: tracked-cards only, 1 observation/(source,variant,currency,day) via unique constraint, insert only on change (carry-forward), retention job aggregates >400d dailies to monthly
- [x] Admin sync UI (/admin): stats, API budget, sync runs table, failed jobs + retry, start catalog/history/retention actions with audit records + rate limit; config warnings (missing key/e-mail/turnstile)
- [x] Verified: 34 unit + 9 integration tests green (full fixture sync e2e, idempotency, history dedup, retry/dead-letter); real local sync running (174 sets, queue chaining confirmed in miniflare)

## Phase 5 — Public site & SEO

- [ ] Homepage, /cards, /cards/:slug, /sets, /sets/:slug, /price-movers
- [ ] /methodology, /about, /blog (MDX + 5 articles), legal pages, /contact
- [ ] Metadata, canonicals, OG/Twitter, structured data, breadcrumbs
- [ ] robots.txt, sitemap index + chunked sitemaps, RSS
- [ ] Redirects (www→apex, trailing slash), 404/410

## Phase 6 — Collection & portfolio

- [ ] Collection CRUD + bulk + filters + table/grid
- [ ] Portfolio calculations (integer minor units, coverage rules)
- [ ] Daily snapshots (idempotent)
- [ ] Dashboard + Chart.js charts (accessible)

## Phase 7 — Binders, checklists, wishlist

- [ ] Binders (9-pocket, share links, privacy)
- [ ] Set checklists + progress cache
- [ ] Wishlist + price alerts (crossing, cooldown)
- [ ] Notifications

## Phase 8 — Import/export & admin

- [ ] CSV export (streamed, formula-injection safe)
- [ ] CSV import (preview/commit, background job, error CSV)
- [ ] Account export + deletion
- [ ] Admin dashboard + audit log

## Phase 9 — Testing & reviews

- [ ] Unit tests (Vitest)
- [ ] Integration tests (@cloudflare/vitest-pool-workers)
- [ ] E2E (Playwright) + accessibility (axe-core)
- [ ] Security review vs threat model
- [ ] Synthetic data generator + performance results

## Phase 10 — Deployment

- [ ] Staging resources + migrations + deploy + smoke tests
- [ ] Production resources + secrets + deploy + health
- [ ] Domain attach (replace parking DNS — owner approved) + www redirect
- [ ] Production smoke tests
- [ ] Final report (SPEC §31)

## Blocked / external dependencies

- RESEND_API_KEY not provided → email flows in honest degraded mode (documented)
- GOOGLE_CLIENT_ID/SECRET not provided → Google OAuth hidden
- info@pokector.com mailbox does not exist yet → recommend CF Email Routing (docs/DEPLOYMENT.md)
- PTCG API key was pasted in chat by owner → rotation after launch recommended (docs/SECRETS.md)
