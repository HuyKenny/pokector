# Pokector — Architecture

Last updated: 2026-07-17 (Phase 0)

## Overview

Cloudflare-native full-stack app, single origin `https://pokector.com`.

```
Browser
  │
  ▼
Cloudflare Worker (pokector-production / pokector-staging)
  ├─ fetch      → React Router v8 SSR (public site, /app, /admin, /api/v1, /api/auth, /health)
  ├─ scheduled  → cron: daily orchestrator (chains jobs via queue wake-ups) (enqueues sync/snapshots/retention/alerts)
  └─ queue      → optional wake-up consumer (Queues available on Free plan; jobs remain D1-backed)
  │
  ├─ D1  (pokector-production)        — relational source of truth
  ├─ KV  (pokector-cache-production)  — cache, rate limits, locks, Better Auth secondary storage
  └─ Pokémon TCG API (server-side only, X-Api-Key)
```

## Stack (verified versions, 2026-07-17)

- React Router **8.2.x** framework mode (SSR) + `@cloudflare/vite-plugin` ^1.45, Vite 8
- TypeScript strict, pnpm 11 (Node 22 LTS local tooling)
- Drizzle ORM 0.45.x (D1 driver) + drizzle-kit migrations
- Better Auth 1.6.23 + `@better-auth/drizzle-adapter` (sqlite provider)
- Tailwind CSS 4, Chart.js + react-chartjs-2, Zod
- Vitest 4.1+ with `@cloudflare/vitest-pool-workers` (`cloudflareTest()` plugin API), Playwright + axe-core
- wrangler 4.111+ (`wrangler.jsonc`, generated types via `wrangler types`)

## Routing structure

| Path                                                                                                               | Purpose             | Caching / indexing                        |
| ------------------------------------------------------------------------------------------------------------------ | ------------------- | ----------------------------------------- |
| `/`, `/cards`, `/cards/:slug`, `/sets`, `/sets/:slug`, `/price-movers`, `/methodology`, `/about`, `/blog/*`, legal | Public SSR          | cacheable, indexed (except filter combos) |
| `/app/*`                                                                                                           | Authenticated app   | `private, no-store`, noindex              |
| `/admin/*`                                                                                                         | Admin UI            | auth+role, noindex                        |
| `/api/auth/*`                                                                                                      | Better Auth handler | —                                         |
| `/api/v1/*`                                                                                                        | Versioned JSON API  | public endpoints cacheable                |
| `/health`                                                                                                          | Health endpoint     | no secrets                                |
| `/robots.txt`, `/sitemap*.xml`, `/rss.xml`, `/.well-known/security.txt`                                            | SEO/security        | resource routes                           |

## Server module layout (`app/`)

```
app/
  routes/            React Router route modules (public, app, admin, api)
  lib/
    auth/            Better Auth factory (per-request, D1+KV), guards, scrypt (node:crypto)
    db/              drizzle schema, repositories (one file per aggregate)
    ptcg/            typed Pokémon TCG API client + normalizers + fixtures
    money/           decimal→minor-units parser, formatting (display only)
    jobs/            D1 job queue: enqueue, claim (lock+expiry), handlers, retry policy
    pricing/         price selection (TCGplayer/Cardmarket), history recording
    portfolio/       market value, cost basis, P/L, ROI, coverage, snapshots
    csv/             escape/inject-safe serializer, streaming export, import parser
    seo/             meta builders, structured data, sitemaps, slugs
    security/        headers (CSP…), rate limit (KV), origin checks, request IDs
    email/           provider abstraction (Resend impl; disabled mode)
workers/app.ts       Worker entry: fetch + scheduled + queue
```

## Key data flows

**Catalog sync (daily + manual):** orchestrator cron inserts `sync_jobs` (type `catalog_sets`, then `catalog_cards_page` per page cursor). Job runner claims jobs with `locked_until` lease, calls PTCG API (timeout/retry/429/budget), normalizes, `db.batch()` upserts, records price observations for tracked cards. A full sync is marked complete only when all page jobs succeed; cards missing from N consecutive complete syncs → `active = false` (never hard delete on a single miss).

**Pricing:** TCGplayer per-variant normalized value = market → mid → low; Cardmarket EUR = trend → averageSell → low. All money stored as integer minor units. Missing price = explicitly unpriced (never 0, never silently another variant).

**Price history:** only for `tracked_cards` (referenced by collections/wishlists/popularity/movers). Max 1 observation per (card, source, variant, currency, day) via unique constraint. Retention job: dailies ≥400 days, then monthly aggregates.

**Portfolio snapshots:** daily after price sync; unique (user, date, currency); recalculable; skipped for unchanged inactive users; never backfilled before tracking start.

**Jobs:** D1 `sync_jobs` is the canonical queue (Free-plan-safe). Cloudflare Queues (now available on Free, 10k ops/day) is used only as an optional wake-up signal to reduce latency; every consumer action re-reads job state from D1 and is idempotent, so dropped/duplicated messages are harmless.

## Cron budget (Free plan = 5 crons per ACCOUNT)

Verified 2026-07-17: the account's other 4 workers use 0 crons.

- `pokector-production`: `17 5 * * *` (daily orchestrator; was also `*/5` until 2026-10-22) → 1 slot
- `pokector-staging`: 0 crons (jobs triggered manually via admin API); staging env overrides `triggers.crons` to `[]` because crons are inherited by default
- 3 slots left free for the owner's other projects

## Caching

- Public HTML/JSON: `Cache-Control: public, s-maxage` + stale-while-revalidate where safe; keyed by canonical URL; never for logged-in-personalized fragments (set completion widgets load client-side or vary correctly).
- KV: hot catalog fragments (homepage popular sets, movers), rate-limit counters, sync locks, Better Auth secondary storage (sessions).
- D1: source of truth; indexed pagination everywhere; no `SELECT *` on hot paths.

## Environments

|         | local               | staging                                              | production                             |
| ------- | ------------------- | ---------------------------------------------------- | -------------------------------------- |
| Worker  | `wrangler dev`/vite | `pokector-staging`                                   | `pokector-production`                  |
| D1      | local miniflare     | `pokector-staging`                                   | `pokector-production`                  |
| KV      | local               | `pokector-cache-staging`                             | `pokector-cache-production`            |
| URL     | localhost           | `pokector-staging.<subdomain>.workers.dev` (noindex) | `https://pokector.com`                 |
| Secrets | `.dev.vars`         | `wrangler secret put --env staging`                  | `wrangler secret put --env production` |

wrangler.jsonc gotchas honored: bindings + `vars` are NOT inherited by named envs (must be re-declared per env); `triggers`/`routes` ARE inherited (staging overrides to empty).
