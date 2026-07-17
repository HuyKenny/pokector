# Pokector — Decision Log

Format: date, decision, reason, alternatives considered.

## 2026-07-16/17 (Phase 0)

### D1. Project location: `~/ai/pokector` as standalone git repo

Owner's workspace `~/ai` is a mixed SEO workspace with its own git history. Pokector
needs its own history, CI and clean root. `pokector/` is gitignored in the parent repo
and indexed in the workspace map (`WORKSPACE_INDEX.md`).

### D2. Node 22.23.1 LTS installed per-user at `~/.local/node/`

System Node on the Raspberry Pi is v20.20.2 (EOL April 2026) and other live projects
depend on it — upgrading system-wide is risky. pnpm 11 requires Node ≥22.13.
Per-user install + `source scripts/env.sh` (PATH prefix) satisfies "current Node LTS
for local tooling" without touching the system. `.nvmrc` = 22.23.1.

### D3. React Router 8.2.x via official `create-cloudflare` react-router template

Spec mandates RR v8 + Cloudflare Vite plugin. C3 template ships RR 8.0.0 + Vite 8 +
Tailwind 4 + wrangler.jsonc with `nodejs_compat`; we upgrade react-router to latest
8.2.x. Worker entry `workers/app.ts` is extended with `scheduled` and `queue` exports
(pattern from the official CF framework guide).

### D4. Jobs: D1-backed queue is canonical; Cloudflare Queues only as wake-up signal

Research (2026-07-17, official docs) shows Queues ARE now available on Workers Free —
but capped at 10,000 ops/day (≈1 message ≈ 3 ops) with fixed 24 h retention. Relying
on Queues as the job store would add a tight daily ceiling and a second source of
truth. Therefore: `sync_jobs` in D1 is the single source of truth with lease-based
claiming (`locked_until`), retries and recovery; a queue message (when the binding
exists) merely wakes the consumer early — the consumer always re-reads D1 state, so
lost/duplicate messages are harmless. Cron `*/5` guarantees progress without Queues.
This satisfies both spec requirements ("use queues where available" + "D1-backed
fallback") in one idempotent design.

### D5. Cron budget: 2 production crons, 0 staging crons

Free plan allows 5 cron triggers per ACCOUNT (not per worker). Verified the account's
4 unrelated workers use none. Production: `*/5 * * * *` job runner + `17 5 * * *`
daily orchestrator. Staging overrides `triggers.crons` to `[]` (crons are inherited
by named envs by default!) and jobs are triggered manually via the admin API.

### D6. Better Auth 1.6.23 integration specifics (verified against current docs)

- Per-request factory `getAuth(env)` — D1 binding exists only per invocation.
- Adapter: `@better-auth/drizzle-adapter` (new standalone package), provider `sqlite`.
- CLI for schema generation is `npx auth@latest generate` (old `@better-auth/cli` is
  stale at 1.4.x) with a stub config; output committed as drizzle schema, migrations
  via drizzle-kit.
- **Password hashing: supply custom `password.{hash,verify}` using `node:crypto`
  scrypt.** Better Auth's default is pure-JS scrypt (@noble/hashes) which is known to
  exceed Workers CPU limits (GH issues #8860, #8456). 10 ms CPU on Free makes the
  default a hard blocker; native scrypt runs in the runtime, not JS.
- Sessions + rate limiting in KV via `secondaryStorage` (min TTL 60 s honored).
- Roles via the first-party `admin` plugin (adds `user.role`, ban fields, setRole API).
- Turnstile via first-party `captcha` plugin (`provider: "cloudflare-turnstile"`).
- IP detection: `advanced.ipAddress.ipAddressHeaders: ["cf-connecting-ip"]`.

### D7. Money: integer minor units end-to-end

All stored money = integer cents (USD) / eurocents (EUR). External decimals parsed by
a string-based decimal parser (no float math), tested against rounding edge cases.
Percentages computed in integer space, formatted at display time only.

### D8. Turnstile widget provisioned via CF API

No dashboard interaction needed: `POST /accounts/{id}/challenges/widgets` returns
sitekey + secret. Separate widgets for production (pokector.com) and staging
(workers.dev hostname). Official always-pass/always-fail test keys used in automated
tests. Uses the owner's global API key stored outside the repo (workspace credentials).

### D9. www redirect via placeholder DNS + Redirect Rule

Per current CF docs, Custom Domains are exact-hostname and the recommended www→apex
pattern is a proxied placeholder record (A 192.0.2.0 / AAAA 100::) + a zone Redirect
Rule. Worker also normalizes host defensively.

### D10. Email: honest degraded mode (no provider configured)

No RESEND_API_KEY available. Registration/login work without verification; password
reset UI states email delivery is unavailable; admin dashboard shows a warning.
`app/lib/email/` is a provider abstraction so Resend can be added later by setting
one secret and flipping config.

### D11. PTCG API key handling

Owner pasted the key into chat (against spec's preferred flow). Mitigation: stored
only in workspace credentials file (`~/ai/credentials/.pokector-credentials.env`,
gitignored, chmod 600), injected via `wrangler secret put` from stdin, never placed
in repo/docs/logs. Rotation on dev.pokemontcg.io recommended after launch (key is
free-tier, low blast radius).

### D12. Legal operator data (provided by owner 2026-07-16)

Operator: Ha Duy Huy, Bartáková 36, 140 00 Praha, Czech Republic; IČO 07876823;
data box dxmsrdt; not a VAT payer; contact/support e-mail info@pokector.com (mailbox
to be created — CF Email Routing recommended, see DEPLOYMENT.md). Site language is
US English; legal pages templated from config vars and flagged for operator review.

### D13. Vitest integration uses current `cloudflareTest()` plugin API

Current official docs (Vitest ≥4.1) use a Vite plugin + `defineConfig`, not the older
`defineWorkersConfig`. D1 migrations applied in test setup via `readD1Migrations` +
`applyD1Migrations` (official fixture pattern).

### D14. Internationalization — 11 locales on public pages (owner-approved, beyond spec v1)

SPEC v1 is US/English-only. Owner requested (2026-07-17) 10 additional UI locales:
de, es, ru, zh-Hans, cs, fr, pt-BR, ja, vi, ar. Scope: **public pages + auth chrome
only** (home, cards, sets, card/set detail, price-movers, public binders, auth). The
signed-in app (/app, /admin), blog articles, and legal pages stay English.

- **URLs**: English at the unprefixed root (x-default); other locales under a short
  prefix (`/de`, `/zh`, `/pt`). Full BCP-47 tags (`zh-Hans`, `pt-BR`) used for
  `<html lang>` + hreflang. No Accept-Language redirects (locale = URL only, per
  Google). `/en/*` → 301 root; `/de/terms|/de/app` → 301 unprefixed; unknown prefix
  → 404.
- **SEO**: every indexable page emits 11 hreflang + x-default and a locale-prefixed
  canonical; sitemap-static + sitemap-sets carry `xhtml:link` alternates. Filtered/
  noindex pages get no alternates.
- **Architecture**: `app/lib/i18n/` — plain nested dictionaries, `en.ts` is the typed
  source of truth (others `satisfies Dict`; unit parity test enforces identical keys).
  Dictionaries are server-only (`dictionaries.server.ts`); components receive namespace
  slices via loader data, so the client never downloads all 11 languages. Card/set
  names + franchise-neutral terms stay English. Arabic = basic RTL (`dir="rtl"` +
  logical Tailwind utilities).
- **Cost**: locale in the path → no `Vary` cache issues; +~50 KB gzip worker bundle.

### D15. Price history recorded for every card, not just tracked ones (owner request 2026-07-17)

SPEC §17 originally gated `card_price_history` to *tracked* cards (in a collection/
wishlist/popular) to limit write volume. On a fresh site this left almost every card's
price chart empty. Owner requested all cards accumulate history so every detail page's
chart has data.

- **Change**: `recordHistoryForCards` no longer joins `tracked_cards` — it records a
  daily observation for every card that has a current price. Still delta-only (insert
  only when the value changed vs. the last observation) and capped at one row per
  card/source/variant/currency/day by the unique constraint.
- **No backfill of the past**: the PTCG API (TCGplayer/Cardmarket via it) returns only
  the *current* price — there is no historical time series to import. History can only
  accumulate forward from the first recorded day; charts start today and grow.
- **Write budget (Free plan, 100k D1 rows/day)**: the initial full population is ~62k
  rows (one per current-price row), spread across the chained per-page catalog jobs.
  Steady state is delta-only (only changed prices), so writes stay modest. The full
  catalog sync (~82k upserts) is the dominant cost, so it runs **~weekly, not daily**
  (owner: weekly is enough, 2026-07-17 — `CATALOG_SYNC_INTERVAL_MS` in scheduler.server.ts);
  the daily orchestrator still handles price history / snapshots / alerts (cheap /
  delta-only). Prices and history therefore refresh weekly. If more frequency is ever
  wanted, the mitigation is Workers Paid (raises D1 write limits) or a delta catalog sync.

### D16. eBay Partner Network "Buy on eBay" affiliate links (owner request 2026-07-18)

Each card detail page gets a "Buy on eBay" button linking to an EPN-tracked eBay
search for the card, so visitors can buy a copy and qualifying sales earn commission.

- **No API, no secret**: the link is built from public EPN tracking params
  (`app/lib/affiliate/ebay.ts`); the Campaign ID (`5339136550`) is public — it appears
  in every affiliate link — so it lives in `wrangler.jsonc` `vars` as `EBAY_CAMPAIGN_ID`,
  not in secrets. Fail-closed: no campaign id → button hidden. Marketplace defaults to
  US (ebay.com), matching our English cards + USD pricing; `EBAY_DE` is ready for a switch.
- **SEO/compliance**: link carries `rel="sponsored noopener"` (Google's paid-link
  requirement) and a visible affiliate disclosure (EPN network agreement); the disclosure
  + button label are localized in all 11 dictionaries.
- **Not eBay Developer API**: the eBay *Browse* API (live lowest listing + price on the
  page) needs real developer creds (App ID + OAuth) and rate-limit handling — deferred.
  NB: the "Account SID / Auth Token" the owner first supplied are Twilio-style, not eBay,
  and are unused (stored in workspace credentials with a note; recommend rotation).
