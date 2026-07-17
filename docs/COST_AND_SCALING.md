# Pokector — Cost & Scaling

Free-first operation on Cloudflare. Limits below verified from official
developers.cloudflare.com documentation, **retrieved 2026-07-16/17**.

## Current plan limits (Workers Free)

| Resource                  | Free limit                                        | Pokector budget notes                                                                                                                         |
| ------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker requests           | 100,000/day (resets 00:00 UTC)                    | public site + app + API combined; HTML caching keeps origin hits low                                                                          |
| CPU time                  | **10 ms per invocation**                          | hard constraint — native scrypt for auth, no heavy per-request loops, batch work in cron/jobs                                                 |
| CPU time per cron run     | 10 ms                                             | job runner processes small batches per tick; long work is split across job claims                                                             |
| Worker size               | 3 MB gzip                                         | keep server bundle lean; charts are client-side                                                                                               |
| Subrequests               | 50/invocation                                     | PTCG sync pages one request per job claim batch                                                                                               |
| Cron triggers             | **5 per account**                                 | 2 used by production, 0 staging, 3 free (other workers use 0 — verified)                                                                      |
| D1 rows read              | 5,000,000/day                                     | indexed queries only; EXPLAIN QUERY PLAN in tests; no unindexed scans on hot paths                                                            |
| D1 rows written           | 100,000/day                                       | catalog daily delta + price observations for _tracked_ cards only (not all 20k cards); each index counts as +1 write                          |
| D1 storage                | 5 GB account / 500 MB per DB                      | catalog ≈ 20,359 cards ≈ tens of MB; history bounded by tracked-cards design + retention aggregation                                          |
| D1 queries per invocation | 50                                                | batch upserts via `db.batch()`                                                                                                                |
| KV reads                  | 100,000/day                                       | cache hits mostly served by Cache API first                                                                                                   |
| KV writes                 | **1,000/day (different keys)**, 1/s per key       | rate-limit counters use short windows per key; sync locks few keys; session writes bounded — monitor, move rate limiting to D1 if ceiling hit |
| KV storage                | 1 GB                                              | trivial usage                                                                                                                                 |
| Queues                    | available on Free: 10,000 ops/day, 24 h retention | used only as optional wake-up signal (D4 in DECISIONS.md); zero reliance                                                                      |

## 10,000-user design target

- 10k registered users, hundreds DAU, 1M collection entries, ~20k catalog cards, years of history.
- Collection queries are cursor/index paginated (`user_id, updated_at` / `user_id, card_id` indexes) — request cost is per-page, independent of collection size.
- 1M collection rows ≈ well under D1 500 MB per-DB cap (rows are narrow); verified with synthetic generator in Phase 9.
- Price history: only tracked cards (union of collections/wishlists/popular/movers), one row per card-variant-source-day, 400-day dailies then monthly rollup → bounded growth.
- Portfolio snapshots: daily per active user; inactive users skipped when portfolio unchanged; monthly rollup for old data.
- Daily writes estimate at target scale: catalog delta (~2k changed cards × price rows) + tracked-card observations (~5–20k) + snapshots (hundreds of DAU) → comfortably under 100k/day; admin dashboard tracks daily counters to warn early.

## Cost triggers (when Free stops being enough)

| Signal                               | First paid step                                           |
| ------------------------------------ | --------------------------------------------------------- |
| >100k requests/day sustained         | Workers Paid $5/mo (also lifts CPU to 30 s, D1/KV quotas) |
| D1 writes near 100k/day              | Workers Paid (50M writes/mo included)                     |
| CPU 10 ms violations (observability) | Workers Paid                                              |

Single upgrade path: everything runs unchanged on Workers Paid; no architectural change needed.

## Measured results (Phase 9, local D1)

Synthetic dataset generated with `scripts/synth-data.mjs` (validated at 516 users
/ 40,006 collection entries against the real 19,629-card synced catalog; the
generator's default target is 10,000 users / 1,000,000 entries — the query plans
below are size-independent because they are index seeks, not scans).

`scripts/perf-test.mjs` — `EXPLAIN QUERY PLAN` on hot paths (timings include
~2 s of `wrangler` CLI startup and are not representative of in-Worker latency;
the **plan** is the signal):

| Query                     | Plan                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| collection by user (page) | `SEARCH collection_entries USING INDEX idx_collection_user_updated (user_id=?)`                                        |
| portfolio sum (user)      | `SEARCH e USING INDEX idx_collection_user_updated` + `SEARCH p USING COVERING INDEX (card_id,source,variant,currency)` |
| snapshots by user+date    | `SEARCH portfolio_snapshots USING INDEX idx_snapshots_user_date (user_id=?)`                                           |
| cards by set              | `SEARCH pokemon_cards USING INDEX idx_cards_set_number (set_id=?)`                                                     |

All per-user and catalog-navigation hot paths are index seeks — request cost is
per-page, independent of total table size, so the 1M-entry target is safe.

**Known characteristic — catalog name search:** `/cards?q=` uses
`name_normalized LIKE 'x%' OR search_text LIKE '%x%'`; the substring `OR` forces
a scan of the (bounded) ~20k-row catalog. Mitigations: public search is
rate-limited (KV), `/cards` responses are edge-cached (`s-maxage`+SWR), and 20k
rows/scan × realistic search volume stays far under the 5M rows-read/day free
budget. If search volume grows, the upgrade path is an FTS5 virtual table
(documented, not yet needed).

## Security review (Phase 9)

- **Client-bundle secret scan** (`build/client/`): no PTCG key, `BETTER_AUTH_SECRET`,
  or Turnstile secret values present; no `.server` modules (createDb / drizzle
  adapter / scrypt) leaked to the client. (The string `POKEMON_TCG_API_KEY`
  appears only inside the admin UI's _instructional_ `wrangler secret put …`
  help text — a variable name, not a value.)
- **Dependency audit** (`pnpm audit --prod`): 1 moderate — GHSA-67mh-4wv8-2f99
  (esbuild dev-server CORS), transitive via `drizzle-kit` → `@esbuild-kit`.
  Affects only `esbuild serve` in local development; not reachable in the
  production Worker. Tracked for upstream resolution.
- **User-data isolation & admin authorization** verified by integration tests
  (collection/binders/wishlist BOLA, foreign-binder 404) and E2E (guarded /app,
  foreign binder id → 404).
