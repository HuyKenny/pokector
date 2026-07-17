# Pokector — Implementation Status

> Living checklist. Update after every phase. Do not mark items complete until
> implemented AND verified. Spec contract: [SPEC.md](SPEC.md).

Last updated: 2026-07-17 (Phase 10 — deployed to production)

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

- [x] Public layout (skip-link, header search, auth-aware CTAs, trademark-disclaimer footer)
- [x] Homepage (hero+search, features, latest sets, recent cards, valuation explainer, CTA, WebSite JSON-LD + SearchAction)
- [x] /cards: D1 search (rate-limited), filters (rarity/supertype/sort), pagination, noindex on filter combos
- [x] /cards/:slug: image, facts, per-variant TCGplayer price table + Cardmarket EUR, source+date, tracking-since, accessible price-history chart (ranges, data table, honest empty state), quick-add CTAs (collection+wishlist, functional), related cards, raw-card disclaimer, breadcrumbs+JSON-LD
- [x] /sets + /sets/:slug: series filter/sorts, set value estimate w/ coverage note, signed-in completion (progressbar, missing cost, owned/missing/rarity/type filters, private no-store via data() headers)
- [x] /price-movers: 7/30-day up/down from REAL history only, honest empty states
- [x] /methodology /about /contact + legal templates (privacy/terms/disclaimer, config-driven operator data, marked for review)
- [x] Blog: MDX pipeline (@mdx-js/rollup + frontmatter), 5 original articles, categories, pagination, Article JSON-LD
- [x] SEO: pageMeta builder (unique titles/descriptions, canonical, OG/Twitter), BreadcrumbList/CollectionPage JSON-LD, robots.txt (staging=disallow all), sitemap index + chunked card sitemaps + sets/blog/static, RSS, security.txt, OG image (brand-only)
- [x] Redirects: www→apex + trailing-slash 301 in worker; 404 catchall; noindex for auth/app/admin
- [x] Verified: 21 routes smoke-tested (200/404/301), card page shows real synced prices, build+lint+typecheck+34 unit tests green

## Phase 6 — Collection & portfolio

- [x] Collection repository (ownership enforced in EVERY query), entry limits, tracked-count + progress-cache maintenance on writes
- [x] /app/collection: add (catalog search dialog w/ evidence-based variant options), inline edit, delete + bulk select/edit/delete, filters (search/variant/condition/unpriced), sorts, pagination, table/grid views, zod-validated intents
- [x] Portfolio calc (pure, unit-tested): market value over priced entries, cost basis over recorded costs, P/L+ROI only over matched entries (missing purchase ≠ 0), valuation+cost coverage
- [x] Variant-exact price matching (never silently another variant); unpriced entries surfaced, never $0
- [x] Daily snapshots: idempotent upsert per (user,day,USD), skip-unchanged job (registered portfolio_snapshots handler), on-view freshness top-up via waitUntil
- [x] Dashboard: headline stats + coverage, daily/7d/30d changes from snapshots (null until real history), most valuable, user's 7-day movers, value by set/rarity/variant, recent activity, accessible portfolio chart (honest start note)
- [x] Verified: 43 unit + 12 integration tests green (calc rules, CRUD isolation, variant-exact pricing, snapshot idempotency); e2e smoke — add entry → collection lists it, dashboard computes correct value/cost/P&L

## Phase 7 — Binders, checklists, wishlist

- [x] Binders: create/rename/describe/delete, 9-pocket front+back pages, place/move(swap)/clear slots (clear keeps the collection entry), page reorder, add-page; ownership enforced on every mutation; accessible click-to-place/move (non-drag)
- [x] Binder sharing: private default, unlisted/public with 128-bit crypto share slug, regenerate + disable; public view sanitized (no purchase price/notes/email — verified in tests); 404 (not 403) on unknown/owned-by-other IDs
- [x] Set checklists: /app/sets progress list (pinned first) + /app/sets/:slug standard & estimated-variant modes, owned/missing/rarity filters, sort missing by price, missing-cost estimate, goals (pin + target date), missing-cards CSV export (dedicated resource route)
- [x] Wishlist + alerts: add/remove/configure (target price, below/above direction, enable), move-to-collection; crossing logic pure + unit-tested (no first-sight fire, no repeat while across, cooldown, wrong-direction ignore, unavailable-price graceful)
- [x] Alerts job (alerts_evaluate, daily cron) → in-app notification + optional e-mail (honest degrade) + price_alert_events delivery record; prior_threshold_state persisted
- [x] Notifications: /app/notifications list, unread badge in app nav, mark-read / mark-all-read
- [x] CSV escape helper (formula-injection-safe) unit-tested
- [x] Fixed D1 100-param limit: set progress computed via JOINs, not IN-lists of every card
- [x] Verified: 55 unit + 15 integration tests green (alert crossings, CSV escaping, binder ownership/privacy); dev smoke — all /app routes 200, binder share unlisted→public view 200 + bad slug 404, checklist + CSV export working

## Phase 8 — Import/export & admin

- [x] CSV export: streamed (paged), documented column order, every cell formula-injection-safe, user-scoped (isolation test), full + filtered; dedicated resource route
- [x] CSV import: bounded parser, validation (row-level errors), card resolution by id then set+number (no silent name matching), preview + append/merge commit via background import_apply job, progress + error report, recent-imports view
- [x] Account data export (JSON, portability) — never includes hashes/tokens; account deletion via Better Auth (password re-auth) with cascade FKs
- [x] Admin: users list (search, entry counts, recalc-portfolio action + audit) — no role changes from UI, no hashes/tokens shown; audit-log viewer
- [x] Versioned public JSON API: /api/v1/cards, /cards/:id (?include=history), /sets, /sets/:id, /price-movers — consistent envelope, request IDs, rate-limited search, cacheable
- [x] Verified: 62 unit + 18 integration tests green (CSV parse/validate/escape, import resolve+apply+merge idempotency, export isolation); dev smoke — import preview→commit→job apply, account JSON export, collection CSV, admin users/audit, API endpoints all 200

## Phase 9 — Testing & reviews

- [x] Unit tests: 62 (Vitest) — money/decimal, pricing selection, variant map, portfolio calc, alert crossings, CSV escape/parse/validate, slug, scrypt
- [x] Integration tests: 18 (@cloudflare/vitest-pool-workers, real D1+migrations) — schema, auth session/isolation, catalog sync idempotency + retry/dead-letter, history dedup, collection CRUD isolation, binder ownership/privacy, import apply+merge, export isolation
- [x] E2E: Playwright desktop + mobile (11 each) — homepage, search, card page, register→onboarding→dashboard, add-to-collection→portfolio value, guarded routes, logout, foreign-binder 404, mobile nav, dark mode, 404
- [x] Accessibility: axe-core WCAG 2.1 AA on 7 key pages — 0 serious/critical (fixed palette contrast to AA, added in-content link underlines, chart canvas aria-label)
- [x] Fixed a real production bug found via E2E: strict CSP blocked SSR hydration → switched to per-request nonce (prod/staging strict, dev unsafe-inline)
- [x] Security review: client-bundle secret scan clean, no .server leak, `pnpm audit --prod` (1 dev-only moderate), isolation/admin authz covered by tests
- [x] Synthetic generator (scripts/synth-data.mjs, up to 10k users/1M entries) + perf script (EXPLAIN QUERY PLAN) — all hot paths index seeks (COST_AND_SCALING.md)
- [x] Full suite green: pnpm lint, typecheck, test, test:integration, test:e2e (desktop+mobile), build

## Phase 10 — Deployment

- [x] Staging: remote D1 migrations, secrets (PTCG, BETTER_AUTH_SECRET, Turnstile test), deployed to https://pokector-staging.huy-kenny.workers.dev
- [x] Staging smoke: health ok, robots disallow-all (noindex), CSP+nonce, register→login→admin, controlled real catalog sync (174 sets + card pages chaining, 0 failed)
- [x] Production: remote D1 migrations, secrets (PTCG, BETTER_AUTH_SECRET, real Turnstile), real Turnstile widget provisioned for pokector.com/www
- [x] Domain attached: parking DNS deleted (6 records, rollback documented), custom domains pokector.com + www.pokector.com; HTTPS live, edge cert provisioned
- [x] Production smoke: health ok, home SSR 200, www→apex 301, trailing-slash 301, HSTS+CSP+frame+referrer headers, robots allow (+CF AI-bot mgmt) with sitemap, no secret in live client bundle, Turnstile enforced (tokenless signup 400)
- [x] Production catalog sync enqueued; daily cron (17:05 UTC) + */5 job runner populate the live catalog
- [x] Final report delivered (SPEC §31)

## Blocked / external dependencies

- RESEND_API_KEY not provided → email flows in honest degraded mode (documented)
- GOOGLE_CLIENT_ID/SECRET not provided → Google OAuth hidden
- info@pokector.com mailbox does not exist yet → recommend CF Email Routing (docs/DEPLOYMENT.md)
- PTCG API key was pasted in chat by owner → rotation after launch recommended (docs/SECRETS.md)
