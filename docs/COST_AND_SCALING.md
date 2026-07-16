# Pokector — Cost & Scaling

Free-first operation on Cloudflare. Limits below verified from official
developers.cloudflare.com documentation, **retrieved 2026-07-16/17**.

## Current plan limits (Workers Free)

| Resource | Free limit | Pokector budget notes |
|---|---|---|
| Worker requests | 100,000/day (resets 00:00 UTC) | public site + app + API combined; HTML caching keeps origin hits low |
| CPU time | **10 ms per invocation** | hard constraint — native scrypt for auth, no heavy per-request loops, batch work in cron/jobs |
| CPU time per cron run | 10 ms | job runner processes small batches per tick; long work is split across job claims |
| Worker size | 3 MB gzip | keep server bundle lean; charts are client-side |
| Subrequests | 50/invocation | PTCG sync pages one request per job claim batch |
| Cron triggers | **5 per account** | 2 used by production, 0 staging, 3 free (other workers use 0 — verified) |
| D1 rows read | 5,000,000/day | indexed queries only; EXPLAIN QUERY PLAN in tests; no unindexed scans on hot paths |
| D1 rows written | 100,000/day | catalog daily delta + price observations for *tracked* cards only (not all 20k cards); each index counts as +1 write |
| D1 storage | 5 GB account / 500 MB per DB | catalog ≈ 20,359 cards ≈ tens of MB; history bounded by tracked-cards design + retention aggregation |
| D1 queries per invocation | 50 | batch upserts via `db.batch()` |
| KV reads | 100,000/day | cache hits mostly served by Cache API first |
| KV writes | **1,000/day (different keys)**, 1/s per key | rate-limit counters use short windows per key; sync locks few keys; session writes bounded — monitor, move rate limiting to D1 if ceiling hit |
| KV storage | 1 GB | trivial usage |
| Queues | available on Free: 10,000 ops/day, 24 h retention | used only as optional wake-up signal (D4 in DECISIONS.md); zero reliance |

## 10,000-user design target

- 10k registered users, hundreds DAU, 1M collection entries, ~20k catalog cards, years of history.
- Collection queries are cursor/index paginated (`user_id, updated_at` / `user_id, card_id` indexes) — request cost is per-page, independent of collection size.
- 1M collection rows ≈ well under D1 500 MB per-DB cap (rows are narrow); verified with synthetic generator in Phase 9.
- Price history: only tracked cards (union of collections/wishlists/popular/movers), one row per card-variant-source-day, 400-day dailies then monthly rollup → bounded growth.
- Portfolio snapshots: daily per active user; inactive users skipped when portfolio unchanged; monthly rollup for old data.
- Daily writes estimate at target scale: catalog delta (~2k changed cards × price rows) + tracked-card observations (~5–20k) + snapshots (hundreds of DAU) → comfortably under 100k/day; admin dashboard tracks daily counters to warn early.

## Cost triggers (when Free stops being enough)

| Signal | First paid step |
|---|---|
| >100k requests/day sustained | Workers Paid $5/mo (also lifts CPU to 30 s, D1/KV quotas) |
| D1 writes near 100k/day | Workers Paid (50M writes/mo included) |
| CPU 10 ms violations (observability) | Workers Paid |

Single upgrade path: everything runs unchanged on Workers Paid; no architectural change needed.

## Measured results

(Phase 9 fills this in: synthetic-scale query timings + query plans.)
