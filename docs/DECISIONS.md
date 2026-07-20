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

### D17. Better Auth secondary storage moved from KV to D1 (incident fix 2026-07-18)

Registration and login were fully broken: every `/api/auth/*` request (even the `/ok`
health check) returned 500 with `KV put() limit exceeded for the day.` Better Auth's
`secondaryStorage` (sessions, verification values, and its per-request rate-limit counter)
was KV-backed, and the Free-plan cap (1k KV writes/day) was exhausted; the unhandled
`env.KV.put` rejection propagated out of the auth handler → blanket 500. Same class as the
search-500 incident (2026-07-17), on the path that fix didn't cover.

- **Change**: new D1 table `auth_kv` (migration 0002) + `app/lib/auth/kv-store.server.ts`
  (get/set/delete/prune, mirroring `counters.server.ts`). `getAuth`'s `secondaryStorage`
  now calls it instead of KV; `rateLimit.storage` stays `"secondary-storage"` so the limiter
  writes to D1 too. Auth no longer touches KV at all (health check is the only KV reader).
- **Fail-open**: storage errors are logged and swallowed (a dropped write means a retry, not
  a site-down 500) — the codebase's counters philosophy. Better Auth logs a benign warning
  that rate limiting is best-effort (no atomic `consume` on the store); acceptable for abuse
  control.
- **Tradeoff**: sessions read from D1 (single-region) instead of KV (edge), but `cookieCache`
  (60s) absorbs most session lookups and D1's 5M reads/day is ample. Keeps the app on the
  Free plan; auth works immediately after deploy (no wait for the KV daily reset).
- Verified: full register→login→add-card→dashboard flow on staging (Turnstile test key);
  production `/api/auth/ok` + `/get-session` = 200 with the KV error gone in live logs.

### D18. Public Pokédex page (owner request 2026-07-18)

A `/pokedex` browse page (like tcgcollector's) listing the full National Pokédex — each
Pokémon's sprite, number, card count, and average card price — as an SEO landing page.

- **Sprites self-hosted**: official front-default sprites (#1..#1025) downloaded to
  `public/sprites/{dex}.png` (~4 MB, `scripts/pokedex/fetch-sprites.mjs`), served from
  `'self'` → no CSP change (external sprite CDNs are blocked by img-src).
- **Species names bundled**: `app/lib/pokedex/species.ts` (dex→English name + generation
  helper), generated once from PokeAPI (`scripts/pokedex/fetch-species.mjs`). The DB has
  dex numbers on cards but no clean species names; English only (consistent with D14).
- **Aggregation on-demand + edge cache**: `listPokedexAggregates` expands
  `national_pokedex_numbers_json` with SQLite `json_each` GROUP BY (new pattern here) →
  per-dex card count + AVG TCGplayer/USD price (one MAX price per card so multi-variant
  cards don't skew). Full national dex (incl. 0-card Pokémon) rendered in one page grouped
  by generation, sprites lazy-loaded, behind `s-maxage=3600`. Precompute table is the
  upgrade path if the cold-cache scan ever breaches the CPU budget.
- Localized + SEO'd like other public pages (11-locale `pokedex` dict namespace, hreflang,
  `/pokedex` in sitemap-static TRANSLATED_PATHS, nav link in both headers).

**Pokédex personalization (2026-07-18)**: generation filter uses region labels
(Kanto (I)…Paldea (IX), `app/lib/pokedex/generations.ts`) like tcgcollector. Signed-in
extras — owned "n/total" per Pokémon, a caught progress bar, and per-Pokémon favourite
stars + a Favorites filter — are personal, so they're fetched client-side from
`/api/v1/pokedex/me` (toggled via `/api/v1/pokedex/favorite`) and layered onto the
edge-cached public page; favourites persist in the `pokedex_favorites` table (migration 0003).

### D19. Live eBay Browse API prices on card pages (owner request 2026-07-18)

Card detail pages show live "from $X" prices next to the affiliate button: the lowest
current eBay listing for the raw card and for a PSA 10 graded copy.

- **Browse API** (OAuth client-credentials app token). Env auto-detected from the App ID
  (`-SBX-` → sandbox, else production). PSA 10 sold/market price would need the restricted
  Marketplace Insights API (eBay approval) — deferred; we show PSA 10 *asking* price.
- **Noise handling**: naive "cheapest match" is junk (stickers, magnets, fan-art,
  keychains, code cards, lots). We query the exact card (name + number/printedTotal + set),
  restrict to the CCG single-cards category, drop novelty/graded titles for the raw price,
  and require "PSA 10" in the title for the graded price, then take the lowest.
- **Caching / rate limit (Free plan)**: OAuth token + per-card prices cached in D1
  (`ebay_cache`, migration 0004) — token ~2 h, prices 24 h. A cache miss returns null and
  refreshes in the background (`ctx.waitUntil`) so renders never block on eBay; a daily
  refresh-budget counter protects the Browse API limit. Disabled (button only) when no
  keyset is configured. Keys are Worker secrets (`EBAY_APP_ID`/`EBAY_CERT_ID`).

### D20. Card grades (Raw / PSA 9 / PSA 10) + conversion CTA + eBay compliance (owner request 2026-07-18)

A new **grade** dimension (`raw`/`psa9`/`psa10`, orthogonal to print variant) across prices,
history, collection and portfolio, plus a conversion-focused "Get this card" CTA and the eBay
compliance webhook.

- **Grade model**: `GRADES` enum; `collection_entries.grade` (default raw). Graded prices are
  eBay lowest-listing "from" values, per card+grade, in separate tables `card_graded_prices` +
  `card_graded_price_history` (not overloading the TCGplayer variant tables). Migration 0005.
- **eBay client**: fetches raw + PSA 9 + PSA 10 (cache key v2, refresh cap 1500 = ~4500 Browse
  calls/day) and persists graded prices on view; a daily job snapshots them into history
  (delta-only, forward-only, viewed cards). PSA = lowest **asking** price, not sold (sold =
  Marketplace Insights, needs eBay approval — deferred).
- **Valuation**: all four entry→price joins (portfolio, dashboard breakdowns, movers,
  listCollection) pick the graded price for graded entries, TCGplayer for raw — so market value,
  P/L, ROI and movers are grade-correct. `calc.ts` unchanged.
- **Card page**: PSA 9/10 rows in the price table (Market only; Low/Mid/High = "—"); the history
  chart toggles Raw variants / PSA 9 / PSA 10; a prominent "Get this card" panel with the official
  eBay logo + "Buy on eBay — from $X". Collection add/edit gains a grade selector.
- **eBay compliance**: `/api/ebay/marketplace-deletion` handles the SHA-256 challenge validation
  (`EBAY_VERIFICATION_TOKEN` secret) and ack (we store no eBay user data). Configure the endpoint
  URL + token in the eBay console to clear "Non Compliant".

### D21. Card CTA layout, 3× eBay buttons, proactive PSA seeding, price-movers copy (owner 2026-07-18)

- **Card page**: "Add to collection" / "Add to wishlist" moved out of the eBay panel to
  directly under the market-prices table. The "Get this card" panel now shows **three stacked
  Buy-on-eBay buttons** (Raw / PSA 9 / PSA 10), each with the official logo + "from $X".
- **Proactive PSA seeding**: new daily job `ebay_graded_seed` (`handleEbayGradedSeed`) fetches
  eBay graded prices for the most valuable cards WITHOUT waiting for a view — page-chained
  (~25/invocation, ≤1000/day), advancing by excluding cards with a fresh (≤24h) `ebay_cache`
  row. Reuses `refreshCardGradedPrices` (exported wrapper of the on-view refresh); seeded
  `card_graded_prices` then flow into `card_graded_price_history` via the existing daily
  `recordGradedHistory`. Enqueued in `enqueueDailyJobs` at +2h (before price_history_record).
- **eBay budget fix**: `refresh` now checks the daily counter via `readCounter` and only
  `incrementCounter`s when it actually calls eBay — previously it incremented before the cap
  check, so no-op-over-budget calls inflated the counter (seen at 5016 vs the 1500 cap) and
  would starve the seed job. Real Browse calls stay ~1500×3 = 4500/day < 5000.
- **price-movers**: not gated on collections (the query runs over the whole catalog); it's just
  empty until ~7 days of history accrue. Reworded the empty state (all 11 locales) to stop
  implying you must register/collect, and pointed the link at the catalog. No data change —
  the owner chose to let USD history accumulate (Cardmarket avg7/avg30 was considered, deferred).

### D22. Graded (PSA 9/10) prices → real sold comps via Marketplace Insights (owner 2026-07-19)

Owner: the PSA 9/10 numbers ("from $X") felt wrong and wanted **precise market values**.
Root cause: they were the **single lowest active listing** — vulnerable to one mispriced /
wrong-grade outlier (e.g. Shining Charizard PSA 10 showing a $30,000 listing). The honest
"precise" number is the **median of real sold transactions**.

- **Chosen path (owner picked B)**: eBay **Marketplace Insights API** (`buy/marketplace_insights/
  v1_beta/item_sales/search`) → median + low/high + sample size of USD sales over the last 90
  days. This is a **limited-release** scope (`…/oauth/api_scope/buy.marketplace.insights`) that
  needs eBay to grant the app access. Built now, dormant until approved.
- **eBay client** (`ebay-api.server.ts`): refactored token fetch into `requestAppToken(scope)`;
  added `getInsightsToken` (separate cache key + a short "off" marker cached on refusal so we
  don't hammer the token endpoint while unapproved) and `soldStats` (median/low/high/count).
  `refresh` now fetches lowest listings (raw+psa9+psa10, for the CTA "from") **and** sold stats
  (psa9+psa10, when the Insights token works), combining them via `toStat`: sold median when
  available, else listing fallback. Cache key bumped `v2`→`v3` (also in the seed selector).
- **Data model** (migration 0006): `card_graded_prices` gains `low_minor`, `high_minor`,
  `sample_size`, `source` ('sold' | 'listing', default 'listing'). `from_minor` = headline
  (sold median or listing fallback); `recordGradedHistory` snapshots it forward as before.
- **Card table**: PSA rows now show the median in Market, the sold **range** in Low/High, and a
  "· N sold" badge; the note switches to "median of real eBay sales (90 days)" when any PSA row
  is sold-sourced, else "lowest current eBay listing". CTA "from $X" buttons stay lowest-listing.
- **i18n**: added `psaSoldMedian` + `psaSampleCount` across all 11 locales.
- **Fallback verified live** (staging + prod): all 616 graded rows are `source='listing'`, table
  renders correctly with the listing note. Flips to sold medians automatically once eBay grants
  Insights access.
- **Owner action**: apply for **Buy Marketplace Insights API** access in the eBay developer
  console (Application Growth Check / API access request). No new secret — it reuses
  EBAY_APP_ID / EBAY_CERT_ID.

### D23. Market selector — US (TCGplayer/USD) vs EU (Cardmarket/EUR) (owner 2026-07-19)

Public pages now let visitors pick a **price market**, independent of language, so
European collectors see Cardmarket EUR (more relevant) instead of TCGplayer USD.

- **Model**: a `pk_market` **cookie** (not a URL segment) resolved per request in
  `workers/app.ts` → `marketContext` (`app/lib/context.ts`). Default for a first-time
  visitor = **Cloudflare geolocation** (`request.cf.country`; EU/EEA/UK/CH → eu, else us).
  Registry `app/lib/market/market.ts` (`MARKETS`, `MARKET_SOURCE`, `MARKET_CURRENCY`,
  `EU_COUNTRIES`, `marketFromCountry`, `marketFromCookieHeader`) mirrors `i18n/locales.ts`.
  Cookie chosen over URL because canonicals strip query and hreflang is a locale×path
  matrix — a market URL dimension would bloat the SEO surface for a personalization pref.
- **Switch**: JS-free `MarketSwitcher` in `public/layout.tsx` posts to a new
  `app/routes/market.ts` action (`Set-Cookie` + redirect back). SEO unchanged.
- **Query layer**: `getPriceMovers` / `getSetBySlug` / `listPokedexAggregates` +
  `getCardPriceHistory` (card page + `api/v1.cards.$id`) + `api/v1.price-movers` take a
  `market` and switch `source`/`currency` (was hardcoded `tcgplayer`/`USD`). Card page:
  US = per-variant USD table + USD chart; EU = single **Cardmarket** row (Trend / Low /
  Avg. sell) + EUR chart, headers relabelled. Cross-market reference line shows the other
  market's headline. **PSA graded stays USD** in both (global eBay-US market) with a note —
  no FX conversion. Cardmarket has no variants/mid/high, hence the simpler EU block.
- **Edge caching**: market-sensitive public routes (card, price-movers, set detail, pokedex)
  switched from shared `s-maxage` to **`private`** cache-control — a URL-keyed shared cache
  would leak one market's prices across visitors. Browsers still cache per-user; Googlebot
  (no cookie) gets the US default, matching canonical. Cost = more Worker invocations on a
  young low-traffic site (acceptable).
- **Scope v1 = public pages only.** Portfolio/collection valuation stays USD (mixing
  currencies + purchase-currency P/L + USD-only graded = a separate future round). The
  switcher lives only in the public layout, so `/app` is never ambiguous.
- **Data**: no migration/re-sync — both TCGplayer USD and Cardmarket EUR (current + history)
  already exist in `card_prices_current` / `card_price_history`. EU history is shallow
  (grows forward) so EU movers/charts fill in over time. i18n +7 keys ×11.
- Verified live (staging + prod): geo default (CZ IP → EU), cookie override both ways,
  EU Cardmarket EUR table + PSA USD note, US unchanged, switch persists.

### D24. Collector-grade card search — FTS5 + typeahead (owner 2026-07-19)

The old search was a single-needle LIKE (prefix-on-name OR substring on a weak
haystack that held the set ID, not its name, and no artist/dex): "base charizard",
"charizard 4/102", and set-name queries returned nothing, there was no ranking, it
full-scanned every query, and there was no typeahead (and no search at all on mobile).

- **FTS5 engine** (migration 0007): standalone `card_search` virtual table over
  name / set_name / series / number(+set total) / rarity / artist / dex / supertype+subtypes,
  `tokenize='unicode61 remove_diacritics 2'`. Populated from the catalog sync
  (`catalog.server.ts`, delete-then-insert per card, no ON CONFLICT on FTS5) and a
  one-time backfill (INSERT…SELECT). D1 supports FTS5.
- **Query builder** `buildFtsMatch` (`catalog/search.server.ts`): splits the query on
  non-alphanumerics (so "4/102" → 4, 102), diacritics-folds, wraps each token as a prefix
  term — except **purely numeric tokens match exactly** so "4/102" hits #4, not #40–49.
  All tokens AND together; a relaxed OR variant powers "did you mean". Ranked by `bm25`
  with column weights (name 10 > number 6 > set 3 > …). `searchCards` branches: text query
  → FTS path, browse (filters only) → the plain indexed path.
- **Typeahead**: public `GET /api/v1/cards/suggest` (rate-limited by IP, min 2 chars, top 8)
  + `HeaderSearch` client component (`components/header-search.tsx`) — debounced 250ms,
  card-thumbnail dropdown (name + set · #number), keyboard nav (↑/↓/Enter/Esc), Enter →
  full `/cards` results. Reuses the debounce pattern from the collection AddCardPanel. Now
  visible on mobile (was `hidden md:block`).
- **/cards page**: added the Set filter (query already supported it), result tiles show
  set year for cross-set disambiguation, and the empty state renders relaxed suggestions.
- Number reality: card `number` is "4" (the "/102" is the set's printedTotal) — so the FTS
  number column indexes `number + printedTotal` to match collector "4/102" notation.
- i18n +5 keys ×11. Unit tests for the query builder. FTS also removes the per-query full
  scan (indexed) — cheaper on the Workers CPU budget. No fuzzy/typo tolerance (owner choice);
  covered by prefix + the relaxed OR fallback.
- Verified live (staging + prod): "base charizard"→Base #4 first, "charizard 4/102"→#4,
  "espeon vmax", "surging sparks" (set name), typeahead dropdown with thumbnails.

### D25. Collector/investor tools — ownership badges, grading ROI, compare, realized P/L (owner 2026-07-19)

A UX pass over the whole site plus four tools that fit data we already store (raw +
PSA 9/10 prices, price history, collection, purchase prices). Competitor/forum scan
(Collectr, TCGplayer, PokeInvest, PokeInvesting, PokeTop10, PriceCharting) confirmed all
four are market-standard; population reports + a "hidden gems"/undervalued signal were
deferred (data-constrained). No duplication of existing features (portfolio P/L, wishlist
alerts, set goals, binders, import/export already existed).

- **Ownership badges** (`getUserCardState` in `collection/queries.server.ts`): signed-in
  users see "In your collection ×N / On your wishlist" on the public card page and a "✓N"
  corner badge on catalog tiles — one batched query over the page's card IDs. Prevents
  duplicate buys. Public `/cards` list goes `Cache-Control: private` **only when signed in**
  (via a loader-set header + `headers()` fallback) so the shared edge cache can't leak one
  user's owned counts; anonymous keeps the shared cache. The card page was already `private`.
- **Grading ROI calculator** (`lib/grading/fees.ts` + `components/grading-calculator.tsx`):
  on the card page, "Is it worth grading?" compares raw cost + PSA fee + round-trip shipping
  against the PSA 9/10 median (sold comps) → net + ROI% + break-even badge, with a client
  tier selector (Value/Regular/Express) and editable raw cost. USD only (the graded market).
  PSA fees are approximate constants in one file. **Data-dependent: renders only when eBay
  PSA data is present** — so it is dark on production until the eBay API access is enabled
  (pending owner action); fully verified on staging.
- **Card comparison** (`/cards/compare?ids=slug,slug,slug`, `components/multi-history-chart.tsx`):
  overlays up to 3 cards' price history on one axis (new multi-series chart kept **separate**
  from the single-series `HistoryChart` so the card/dashboard charts are untouched), with a
  suggest-powered picker and a "Compare" CTA on each card. `noindex`, `private` (market cookie).
- **Realized P/L / sales** (migration 0008 `card_sales`): a "Sell" action on each collection
  entry (`sales.server.ts` `recordSale`) snapshots the entry's purchase price as cost basis
  (lot-accurate — the user sells a chosen entry, so no separate FIFO engine), draws the lot
  down (deletes the entry at zero), and writes a sale. New `/app/sales` page (realized P/L,
  proceeds net of fees, cost basis, year filter, tax CSV export) + an all-time realized strip
  on the dashboard. Kept a **separate axis** from portfolio snapshots (which value only current
  holdings) so P/L isn't double-counted. Unpriced lots are excluded from realized P/L (flagged).
- i18n +41 keys ×11 (ownership, grading, compare); `/app` surfaces stay English per convention.
  Unit tests for grading ROI + realized P/L math + summary. Verified end-to-end on staging
  (register → add → ownership badge → sell → sales page + dashboard strip + CSV; grading calc;
  compare) and on production (ownership/compare/sales; grading calc awaits eBay data).

### D26. i18n 404 fix, wishlist region currency, unified header (owner 2026-07-19)

Three reported bugs.

- **404 on "Manage in collection" in non-English locales.** The link used
  `lp("/app/collection")` → `/cs/app/collection`; `/app/*` is not in the localized
  route tree, so client-side navigation flashed the catchall 404 (the server-side
  301 only helps on a hard load). Fixed to a plain `/app/collection`. A sweep
  (`grep 'lp("/…'`) confirmed it was the *only* `lp()` pointing at a non-localized
  route — all other lp() targets (cards/sets/login/register) are localized.
- **Wishlist was USD-only.** Added a "Region & language" section to Settings
  (`preferences` intent → `userProfiles.defaultCurrency` + `locale`). New users
  default from registration location: region from geo (`getMarket`), language from
  `Accept-Language` (`localeFromAcceptLanguage`), set once at onboarding guarded on
  the legacy `en-US` default; fallback US/USD + English. `wishlist-quick-add` now
  stamps the user's region currency; the configure form has a per-item currency
  toggle. **Critical join fix**: the wishlist loader AND the alert-evaluation job
  joined `card_prices_current` on `source='tcgplayer'` unconditionally, so EUR items
  were always "unpriced" and never triggered alerts — now `source = CASE WHEN
  currency='EUR' THEN 'cardmarket' ELSE 'tcgplayer' END` (cardmarket is stored
  per-variant, so the PK join still matches one row).
- **Unified header** — new shared `app/components/site-header.tsx` used by BOTH the
  public and app layouts (moved MarketSwitcher/LanguageSwitcher + hamburger + account
  menu out of the layouts). Identical everywhere (PC + mobile, hamburger < lg); the
  only auth-state difference is the account slot: signed-out = Sign in / Get started;
  signed-in = notifications bell + "My collection" account dropdown. Public layout now
  fetches `unreadCount` when signed in so the header is the same on public pages too.
  App layout passes `locale = profile.locale` so the header nav follows the user's
  chosen language; the language switcher is hidden in-app (`inApp` — language is set in
  Settings). App-area menu labels stay English (app is English-only), so no new i18n
  keys were needed. Verified e2e (staging+prod): CZ registrant → EUR + Czech nav
  auto-defaulted, Manage link → /app/collection, wishlist EUR, unified header.

### D27. SEO overhaul — structured data, keyword pillar pages, on-page (owner 2026-07-20)

Senior-SEO pass targeting "pokemon card collectors" + the tracker/price/checklist/
grading cluster. Audit finding: the technical SEO layer was already strong (sitemap
index, env-gated robots, canonical/redirect/noindex/hreflang, unique localized meta),
so the work is **additive**. Ahrefs reality check: the literal phrase is low-value
(TP ~60, Reddit/Amazon SERP); the traffic lives in the sibling cluster — pokemon card
tracker (800), collection tracker (400), **price tracker (TP 93k)**, tracker app (KD
22), set checklists (KD 0), psa (KD 1). Changes:

- **Structured data** (`app/lib/seo/meta.tsx`): new `productJsonLd` (Product +
  AggregateOffer) on card detail — **only when the active market prices the card**
  (guard on `activeRows`, honest: no $0/ratings); `organizationJsonLd` rendered once
  on home + `WebSite.publisher` `@id` reference; `faqPageJsonLd` on the two new
  landings. Set detail already had BreadcrumbList + visible nav (agent grep was wrong).
- **OG images**: `resolveOgImage` makes every `og:image` **absolute** (relative paths
  are rejected by some crawlers) and falls back to the branded `pokector-og.png` (the
  previously-unused `DEFAULT_OG_IMAGE`) when a page passes no image; home switched off
  the square icon. `appUrl` threaded to about/blog/methodology/contact meta.
- **Card sitemap hreflang**: `sitemap-cards.ts` now emits `<xhtml:link>` alternates per
  card (parity with sets; compact one-`<url>`-per-card form to stay under 50k/file).
- **On-page**: home gained an indexable `introSeo` line (keyword-bearing, translated
  ×11); footer restructured into an **Explore** hub group (Cards/Sets/Price movers/
  Pokédex + the two new landings, localized) + Resources.
- **New localized landing pages** (both under `:locale`, all 11 locales, in
  `sitemap-static` TRANSLATED_PATHS): `/pokemon-card-collectors` (`collectors.tsx`,
  `collectorsLanding` dict) — pillar owning the keyword, tool cards → tracker/price/
  sets/grading/compare/binders, FAQPage. `/pokemon-card-grading-calculator`
  (`grading.tsx`, `gradingLanding` dict) — a **fully interactive** standalone calc
  (`standalone-grading-calculator.tsx`, all numbers user-entered — no fabricated data)
  + explainer + FAQ, targeting "psa pokemon cards" / "is grading worth it".
- **Blog**: 3 new English posts (how to start a collection [KD 0], are cards a good
  investment, is grading worth it) interlinked to the pillar + tools. **Deferred**: the
  blog-localization refactor (locale-aware routing + EN fallback) — higher risk/lower
  value for an English target; posts ship in EN now, refactor is a scoped follow-up.

Verified e2e (staging + prod, cache purged): Product/Organization/FAQ JSON-LD live,
absolute branded OG, card-sitemap hreflang, both landings 200 in EN + `/cs/…`, footer
hubs, 3 posts indexed. typecheck/lint/**101 tests** green (i18n parity across 11).

### D28. Pokector Pro — subscription billing (Stripe), Phase 1 MVP (owner 2026-07-20)

A competitor gates a Premium tier behind mostly organizational features. Pokector already
gives most of those away free, so Pro is positioned **"invest smarter"** (scale + market
intelligence), not "organize more". Confirmed: match competitor pricing (~$3.99/mo, ~$40/yr,
set in Stripe); Phase-1 MVP; no Discord.

- **Free vs Pro split** — the whole collection stays **free to track** (a marketing win). Pro
  meters power-user scale: binders 3→∞, wishlist 100→2000, active alerts 3→∞, graded cards
  10→∞, pinned sets 1→∞, portfolio history 30d→full, plus the Pro badge. Kept **free**
  (deliberately not paywalled, unlike the competitor): grading calculator, price movers,
  cost-to-completion, CSV/JSON export, realized+unrealized P/L. **Nothing existing users have
  is clawed back** — over-cap data is grandfathered (reads stay; only new *adds* are blocked
  with an `upgrade` hint on the existing `{code:"limit"}` 422).
- **Architecture** — no `stripe-node` SDK. Raw-`fetch` Stripe client
  (`app/lib/billing/stripe.server.ts`, form-encoded like the eBay token call) + **hosted**
  Checkout + Customer Portal (offsite redirects → no CSP change, minimal PCI, no publishable
  key needed). Webhook (`routes/api/stripe-webhook.ts`) reads the raw body, verifies HMAC-SHA256
  via WebCrypto (mirrors the eBay digest idiom), then **enqueues `subscription_sync` keyed by the
  Stripe event id** (queue dedupe = idempotency) and acks 200. The job
  (`jobs/handlers/subscription.server.ts`) fetches the authoritative subscription and writes the
  entitlement cache onto `userProfiles`.
- **Entitlement** — migration `0009` adds `plan / planStatus / planInterval / stripeCustomerId /
  stripeSubscriptionId / premiumUntil` to `userProfiles`. `isPremium` = `premiumUntil > now`
  (access kept through the paid period after cancel). `limitsFor(plan)` in `app/lib/limits.ts`
  (LIMITS kept for non-tiered abuse caps); gating threaded into the existing count-check choke
  points via `getUserPlan(db, userId)`.
- **UI** — public **/pricing** (localized ×11, in `:locale` tree + nav + footer +
  `sitemap-static`): Free-vs-Pro table, monthly/yearly toggle, FAQPage; signed-out CTA →
  register-then-checkout. **/app/billing** (English, `noindex`): checkout (free) + Customer
  Portal (pro). Header: Pro badge + "Upgrade to Pro" (layout dict, ×11). App-area billing UI
  stays English (app is English-only).
- **Config/secrets** — `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` are Worker secrets
  (`app/env.d.ts`, degraded-mode optional); `STRIPE_PRICE_MONTHLY/YEARLY` are non-secret
  `wrangler.jsonc` vars (per-env, placeholder `price_*_replace_me_*`). Absent key → pricing page
  still renders, checkout/portal disabled (honest degraded mode). **The live `sk_live` key
  pasted in chat is compromised → owner rolls it; keys never touch code/git.**

typecheck/lint/**111 tests** green (i18n parity ×11); build clean. Migration applied + deployed
to **staging** (billing degraded there w/o test keys; pricing/gating verified live). **Not on
production yet** — pending owner Stripe setup (roll key, create Pro product + monthly/yearly
prices, set secrets + price-ID vars, add webhook endpoint), because activating the free-tier caps
before Pro is purchasable would limit existing users with no upgrade path.
