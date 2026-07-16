# Pokector — Implementation Status

> Living checklist. Update after every phase. Do not mark items complete until
> implemented AND verified. Spec contract: [SPEC.md](SPEC.md).

Last updated: 2026-07-17 (Phase 0 in progress)

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

- [ ] Drizzle schema (all SPEC §19 tables + Better Auth tables)
- [ ] Migrations generated + applied locally
- [ ] Repository layer
- [ ] Seed fixtures (real API snapshots for deterministic tests)

## Phase 3 — Auth & security foundation

- [ ] Better Auth (email+password, sessions, KV secondary storage)
- [ ] Native scrypt password hashing (node:crypto) — Workers CPU limit workaround
- [ ] Roles (admin plugin), `pnpm admin:grant`
- [ ] Turnstile (captcha plugin + widget provisioning)
- [ ] Security headers middleware (CSP, HSTS, etc.)
- [ ] Rate limiting (KV)
- [ ] Account settings routes

## Phase 4 — Catalog sync

- [ ] Typed PTCG API client (timeout/retry/429/backoff/jitter/budget)
- [ ] Decimal→minor-units parser (tested)
- [ ] Price normalization (TCGplayer USD, Cardmarket EUR)
- [ ] Sets+cards+prices sync (idempotent, cursor, lock)
- [ ] D1 job queue + cron triggers + recovery
- [ ] Admin sync UI

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
