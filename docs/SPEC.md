# Pokector — Product & Engineering Specification (verbatim contract)

> Source: project owner brief, received 2026-07-16. This is the binding requirements
> document for the Pokector build. Do not weaken requirements here; record deviations
> in `DECISIONS.md`.

You are the lead software engineer, product engineer, security engineer, database architect, QA engineer, SEO engineer, and Cloudflare deployment engineer for this project.

Build and deploy a complete production-ready web application called Pokector.

Do not create an MVP, prototype, mockup, demo-only application, or unfinished skeleton. Build a usable production version with all functionality defined below.

==================================================
1. PRODUCT DEFINITION
==================================================

Product name:
Pokector

Production domain:
pokector.com

Target market:
United States

Default language:
American English

Default currency:
USD

Product purpose:
Pokector is an independent web application for Pokémon TCG collectors. Users can browse the card catalog, track their raw card collection, monitor estimated market value, calculate profit and loss, organize cards into binders, complete set checklists, create wishlists, configure price alerts, import and export collections, and view price and portfolio charts.

Pokector is not affiliated with, endorsed by, sponsored by, or officially connected to Nintendo, The Pokémon Company, Game Freak, Creatures, TCGplayer, Cardmarket, or the Pokémon TCG API.

Do not copy Collectr's code, text, visual design, layout, brand assets, or proprietary data. The product may offer comparable collection-tracking functionality, but it must have its own architecture, interface, copy, and visual identity.

This version supports:
- Individual raw Pokémon TCG cards
- English-language catalog data provided by the Pokémon TCG API
- TCGplayer USD prices as the primary US valuation source
- Cardmarket EUR prices as an optional secondary source
- Price history collected by Pokector from the time tracking begins

This version does not support:
- PSA, BGS, CGC, ACE, or other graded-card prices
- Sealed products
- Marketplace transactions
- Auctions
- User-to-user payments
- Messaging
- Social feeds
- Native mobile applications
- Camera scanning
- AI card recognition
- Fake or generated historical price data

==================================================
2. REQUIRED OPERATING MODE
==================================================

Work in the current repository.

First inspect:
- Existing files
- Git status
- Installed Node.js version
- Package manager availability
- Cloudflare MCP availability
- Wrangler authentication
- Cloudflare account resources
- Whether the pokector.com zone exists in the connected Cloudflare account
- Whether any existing resources already belong to Pokector

Use Cloudflare MCP for Cloudflare account and resource operations when supported.

Use Wrangler for local development, migrations, generated bindings, validation, testing, and deployment.

Do not delete, overwrite, rename, or modify unrelated Cloudflare resources.

Do not overwrite existing DNS records, Worker routes, D1 databases, KV namespaces, queues, or custom domains unless they are clearly associated with this project.

If pokector.com contains conflicting production DNS or Worker routes:
- Do not remove them
- Deploy the project to a safe staging or workers.dev URL
- Document the conflict and the exact manual resolution steps

Do not stop after writing a plan.

Create these files immediately:
- docs/IMPLEMENTATION_STATUS.md
- docs/ARCHITECTURE.md
- docs/DECISIONS.md
- docs/SECURITY.md
- docs/DEPLOYMENT.md
- docs/COST_AND_SCALING.md
- docs/DATA_METHODOLOGY.md

Use IMPLEMENTATION_STATUS.md as a checklist and update it after every phase.

Use DECISIONS.md to record important technical decisions and their reasons.

Continue implementing phase by phase until:
- All required features are complete
- Automated tests pass
- The staging deployment passes smoke tests
- Production deployment is completed where safely possible
- Any unavoidable external credential or legal dependency is clearly documented

Do not ask broad planning questions.

Use sensible production defaults when a decision can be made safely.

Only require user interaction for:
- Cloudflare login or authorization
- Secret entry in the terminal
- A missing domain ownership action
- External OAuth credentials
- External email provider credentials
- Legally required operator information

Never ask for API keys or secrets to be pasted into source files, chat messages, documentation, commits, or configuration files.

Never expose secrets to client-side code.

Before choosing package versions, Cloudflare configuration fields, authentication APIs, or binding definitions, retrieve and verify the latest official documentation.

Use current stable package versions that are compatible with Cloudflare Workers.

==================================================
3. REQUIRED ARCHITECTURE
==================================================

Build a Cloudflare-native full-stack application.

Required stack:
- React Router v8 full-stack framework
- Server-side rendering
- Cloudflare Workers
- Cloudflare Vite plugin
- TypeScript with strict mode
- pnpm
- Current Node.js LTS for local tooling
- Cloudflare D1
- Drizzle ORM using the D1 driver
- Drizzle migrations
- Better Auth
- Better Auth Drizzle adapter with SQLite provider
- Cloudflare KV
- Cloudflare Queues when available on the current account plan
- A D1-backed job queue fallback if Cloudflare Queues are unavailable
- Cloudflare Cron Triggers
- Cloudflare Turnstile
- Tailwind CSS
- Chart.js with an appropriate React integration
- Zod for validation
- Vitest
- Cloudflare Workers Vitest integration
- Playwright
- axe-core Playwright integration
- ESLint
- Prettier

Do not use:
- WordPress
- WEDOS as the application backend
- Supabase
- Firebase
- Vercel
- Next.js
- Paid UI components
- Paid chart libraries
- A paid database
- A separate traditional server
- Client-side direct access to the Pokémon TCG API
- Hardcoded API keys
- A client-only SPA for public SEO pages

Use one origin:
https://pokector.com

Public pages and the authenticated application must share the same origin. This avoids unnecessary CORS and cross-domain cookie complexity.

Suggested path structure:
- Public site at /
- Authenticated application at /app/*
- Administration at /admin/*
- Versioned JSON API at /api/v1/*
- Better Auth handler at /api/auth/*
- Health endpoint at /health

Use a single Worker entry point that supports:
- fetch handler
- scheduled handler
- queue consumer handler

The fetch handler must delegate web requests to React Router while preserving the scheduled and queue handlers.

Use wrangler.jsonc, not wrangler.toml.

For a new project:
- Set compatibility_date to the current date
- Enable the currently recommended nodejs compatibility flag
- Enable Cloudflare observability
- Generate binding types with wrangler types
- Do not manually maintain a generic Env interface
- Validate wrangler configuration against the installed schema

Create separate staging and production environments.

Suggested Cloudflare resource names:

Production:
- Worker: pokector-production
- D1: pokector-production
- KV: pokector-cache-production
- Queue: pokector-jobs-production

Staging:
- Worker: pokector-staging
- D1: pokector-staging
- KV: pokector-cache-staging
- Queue: pokector-jobs-staging

Use actual generated resource IDs in the correct environment configuration.

Do not use R2 unless a real requirement is found. CSV exports should normally be streamed directly rather than stored.

==================================================
4. REQUIRED SECRETS AND CONFIGURATION
==================================================

Required server-side secrets:
- POKEMON_TCG_API_KEY
- BETTER_AUTH_SECRET
- TURNSTILE_SECRET_KEY

Optional server-side secrets:
- RESEND_API_KEY
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET

Required non-secret environment variables:
- APP_NAME=Pokector
- APP_URL
- ENVIRONMENT
- DEFAULT_CURRENCY=USD
- DEFAULT_LOCALE=en-US
- TURNSTILE_SITE_KEY
- SUPPORT_EMAIL
- LEGAL_OPERATOR_NAME
- LEGAL_CONTACT_EMAIL

Do not commit real values for secrets.

Create:
- .dev.vars.example
- .env.example
- docs/SECRETS.md

Add real secret files to .gitignore.

If POKEMON_TCG_API_KEY is unavailable:
- Keep local development and automated tests working with fixtures
- Disable real catalog synchronization
- Show a clear admin warning
- Print the exact interactive wrangler secret command
- Do not place a fake key in the project

Use an interactive secret command such as:
wrangler secret put POKEMON_TCG_API_KEY

Do not print the entered secret afterward.

Generate BETTER_AUTH_SECRET using a cryptographically secure method.

==================================================
5. BRAND AND DESIGN
==================================================

Create an original visual identity for Pokector.

Do not use:
- Official Pokémon logos
- Poké Ball designs
- Official Pokémon fonts
- Pikachu or other Pokémon characters in the logo
- Nintendo, Game Freak, Creatures, or The Pokémon Company graphics
- Collectr visual design
- Collectr color palette
- Collectr copy

Create:
- A text wordmark for Pokector
- An original abstract icon based on a card grid, binder slots, or portfolio chart
- SVG logo files created from original geometric shapes
- Favicon
- Web app manifest
- Social sharing image using only original Pokector brand elements

Design direction:
- Premium collector dashboard
- Modern but not excessively futuristic
- Original and restrained
- Mobile-first
- Light and dark mode
- Clear financial data presentation
- Accessible contrast
- Comfortable spacing
- Strong empty states
- Skeleton loading states
- Clear error messages

Suggested original palette:
- Deep ink background
- Warm off-white surface
- Mint accent
- Coral secondary accent
- Neutral gray data colors

Do not use yellow and blue as the dominant brand pairing because it would imitate familiar Pokémon branding.

Use system fonts or locally bundled open-source fonts. Do not require Google Fonts at runtime.

Meet WCAG 2.2 AA where practical.

All interactive controls must support:
- Keyboard navigation
- Visible focus
- Screen readers
- Touch targets appropriate for mobile

Charts must have:
- Accessible text summary
- A data table alternative
- Keyboard-accessible time-range controls
- Clear labels and tooltips

==================================================
6. PUBLIC WEBSITE
==================================================

Create these public routes:

/
- Original homepage
- Product explanation
- Main benefits
- Search box
- Popular sets
- Recently updated cards
- How valuation works
- Set completion feature
- Portfolio feature
- Original CTA for registration
- Trademark disclaimer

/cards
- Paginated catalog
- Search
- Filters
- Sorting
- Server-rendered results
- No external API request during a normal user search

/cards/:cardSlug
- Card image
- Card name
- Set
- Set number
- Rarity
- Artist when available
- Types
- HP when available
- Available variants
- Current TCGplayer prices
- Optional Cardmarket prices
- Price source
- Source update date
- Pokector tracking start date
- Price history chart
- Add to collection CTA
- Add to wishlist CTA
- Related cards from the same set
- Link to the source marketplace where provided
- Clear raw-card valuation disclaimer

/sets
- Paginated set catalog
- Filter by series
- Sort by release date, name, and number of cards
- Set logo and symbol where provided

/sets/:setSlug
- Set information
- Release date
- Printed total
- Total card count
- Complete card list
- Current estimated set value where enough pricing exists
- User set completion when logged in
- Estimated missing-card cost when logged in
- Filters for owned, missing, rarity, and card type
- Standard checklist mode
- Optional estimated variant checklist mode
- Clear explanation when variant data may be incomplete

/price-movers
- 7-day price increases
- 7-day price decreases
- 30-day price increases
- 30-day price decreases
- Minimum history requirements
- No results until enough real history exists
- Never fabricate price changes

/methodology
- Explain data sources
- Explain price normalization
- Explain valuation limitations
- Explain that condition does not automatically modify the value
- Explain history start dates
- Explain missing-price behavior
- Explain currency behavior

/about
- Original Pokector story and purpose
- Independent project disclaimer

/blog
- MDX-based blog index
- Pagination
- Categories
- RSS feed

Create several useful original starter articles:
- How to Track a Pokémon Card Collection
- How Pokémon Card Market Prices Work
- How to Organize a Pokémon Card Binder
- How to Complete a Pokémon TCG Set
- Understanding Card Condition and Raw Market Value

Do not create unsupported investment promises or financial advice.

/privacy
/terms
/disclaimer
/contact

Legal pages must be templates suitable for legal review.

Do not invent a legal company name or physical address.

Use configuration variables for operator and contact information.

Clearly mark the legal documentation as requiring operator review before public launch if required values are missing.

==================================================
7. AUTHENTICATION AND USERS
==================================================

Use Better Auth with D1 and Drizzle.

Implement:
- Email and password registration
- Email and password login
- Logout
- Session management
- Secure HTTP-only cookies
- Account settings
- Change password
- Forgot password
- Reset password
- Email verification when an email provider is configured
- Optional Google OAuth when credentials are configured
- Account export
- Account deletion
- Re-authentication before destructive account actions

If RESEND_API_KEY is configured:
- Send email verification
- Send password reset email
- Send optional price alerts
- Use a provider abstraction so the email provider can be replaced later

If no email provider is configured:
- Login and registration must still work in the configured non-verification mode
- Admin must see a production warning
- Password-reset email functionality must show a clear unavailable state
- Do not pretend that an email was delivered

Protect registration and sensitive auth forms using Turnstile.

Add rate limits for:
- Registration
- Login
- Password reset
- Email verification resend
- Search
- Imports
- Exports
- Price-alert configuration
- Admin jobs

Create user roles:
- user
- admin

Do not grant admin based only on a client-side value.

Create a secure CLI or admin provisioning command:
pnpm admin:grant --email user@example.com

The command must:
- Find an existing verified user
- Update the role server-side
- Require explicit confirmation
- Work against local, staging, or production D1
- Record an admin audit event

Every user-owned query must include the authenticated user ID.

Never trust a user ID supplied by the browser.

==================================================
8. AUTHENTICATED APPLICATION
==================================================

Create these authenticated routes:

/app
Dashboard

/app/collection
Collection management

/app/binders
Binder list

/app/binders/:binderId
Visual binder

/app/sets
Personal set progress

/app/sets/:setSlug
Personal checklist

/app/wishlist
Wishlist and price alerts

/app/import
CSV import

/app/export
CSV export

/app/notifications
In-app notifications

/app/settings
Account and application settings

/app/onboarding
First-use onboarding

All /app routes must:
- Require authentication
- Use private no-store caching
- Include noindex metadata
- Have route-level error boundaries
- Handle expired sessions cleanly

==================================================
9. DASHBOARD AND PORTFOLIO
==================================================

The dashboard must show:

- Estimated current market value
- Total recorded cost basis
- Unrealized profit or loss
- ROI percentage
- Number of unique cards
- Total quantity
- Number of priced items
- Number of unpriced items
- Pricing coverage percentage
- Daily change
- 7-day change
- 30-day change
- Most valuable cards
- Largest gainers in the user's collection
- Largest decliners in the user's collection
- Value by set
- Value by rarity
- Value by variant
- Recent collection activity

Portfolio chart ranges:
- 7D
- 1M
- 3M
- 6M
- 1Y
- MAX

Do not create fake historical values.

When no history exists:
- Show the current value as the first point
- Explain that portfolio tracking started on that date
- Do not backfill previous dates

Financial calculations must use integer minor currency units.

Do not use floating-point arithmetic for stored monetary values.

For USD:
- Store cents as integers

For percentages:
- Calculate with sufficient precision
- Format only at display time

Portfolio calculation rules:

Current market value:
Sum of normalized current price multiplied by quantity for priced collection entries.

Recorded cost basis:
Sum of recorded unit purchase price multiplied by quantity for entries with a purchase price.

Profit or loss:
Only calculate against entries that have both a recorded purchase price and an available current price.

Do not treat a missing purchase price as zero for ROI purposes.

Show:
- Market value
- Cost basis coverage
- Valuation coverage
- Unpriced value count

An unavailable card price must not silently become zero.

==================================================
10. COLLECTION MANAGEMENT
==================================================

Users must be able to:

- Search the local Pokector catalog
- Add a card to the collection
- Edit a collection entry
- Delete a collection entry
- Bulk-select and bulk-edit entries
- Add multiple acquisition lots for the same card
- Track quantity
- Track card variant
- Track condition
- Track language
- Track purchase price per card
- Track purchase date
- Add plain-text notes
- Assign cards to a binder
- Filter collection
- Sort collection
- Paginate collection
- View collection as table or grid
- Export filtered or full collection

Supported condition values:
- Near Mint
- Lightly Played
- Moderately Played
- Heavily Played
- Damaged

Store condition as user metadata.

Do not automatically apply condition multipliers to market value.

Clearly state that the displayed market value is an estimated raw market price and may not represent the user's exact physical card condition.

Supported variants must be derived from actual available source data where possible, including:
- normal
- holofoil
- reverseHolofoil
- firstEditionNormal
- firstEditionHolofoil

Do not show a variant as available if no catalog or price evidence exists for it.

Use cursor or indexed pagination. Do not load an entire large collection in one request.

==================================================
11. BINDERS
==================================================

Implement full binder management:

- Create binder
- Rename binder
- Edit binder description
- Delete binder with confirmation
- Private by default
- Optional unlisted share link
- Optional public binder
- Regenerate share link
- Disable sharing
- Multiple binders per user
- 9-pocket visual pages
- Front and back page support
- Reorder binder pages
- Move cards between slots
- Remove a card from a slot without deleting it from the collection
- Empty slots
- Accessible non-drag alternative
- Mobile-friendly binder view

Use an accessible drag-and-drop implementation or provide explicit move controls.

A user must never be able to edit another user's binder by changing a route parameter.

Public or unlisted binders must never expose:
- Purchase price
- Personal notes
- User email
- Private account information

==================================================
12. SET CHECKLISTS
==================================================

Implement automatic set completion based on collection data.

Standard checklist mode:
- A card is owned when the user has quantity greater than zero for the card ID
- Completion counts unique card IDs
- Display owned count
- Display missing count
- Display completion percentage
- Display estimated cost of missing cards
- Show missing-card list
- Add missing card to wishlist
- Add owned card directly from checklist

Estimated variant checklist mode:
- Derive variants only from available source data
- Clearly label the mode as estimated
- Explain that API variant coverage may be incomplete

Allow users to:
- Pin favorite sets
- Create a set completion goal
- Add target date
- Filter owned and missing cards
- Sort missing cards by price
- Export missing cards to CSV

Cache progress where useful, but collection data remains the source of truth.

Invalidate or update progress cache when collection entries change.

==================================================
13. WISHLIST AND PRICE ALERTS
==================================================

Users can:
- Add cards to wishlist
- Choose variant
- Set target price
- Choose alert direction:
  - Price falls below target
  - Price rises above target
- Enable or disable alerts
- Remove wishlist item
- Add wishlist item to collection

Price alert behavior:
- Trigger only when the price crosses the threshold
- Do not send the same alert every day
- Store the prior comparison state
- Apply a cooldown
- Create an in-app notification
- Send email only when an email provider is configured
- Record delivery status
- Handle unavailable prices gracefully

==================================================
14. CSV IMPORT AND EXPORT
==================================================

Create a documented Pokector CSV format.

Required export columns:
- pokector_card_id
- card_name
- set_id
- set_name
- card_number
- quantity
- variant
- condition
- language
- purchase_price
- purchase_currency
- purchase_date
- notes
- binder_name

CSV export:
- Stream the response
- Escape CSV correctly
- Support current filter export
- Support complete collection export
- Use a safe filename
- Do not expose another user's data

CSV import:
- Upload or paste CSV
- Validate content type and size
- Parse safely
- Show validation preview
- Show row-level errors
- Resolve cards by Pokector card ID first
- Fall back to set ID and card number
- Do not use unreliable name-only matching without user confirmation
- Support append mode
- Support merge mode
- Require confirmation before writing
- Make the write idempotent when possible
- Process large imports through a background job
- Create import progress and result views
- Allow downloading an error CSV

Do not allow spreadsheet-formula injection in exported values. Prefix dangerous cells where required.

==================================================
15. POKÉMON TCG API INTEGRATION
==================================================

API base:
https://api.pokemontcg.io/v2

Send the API key only through the server-side X-Api-Key header.

Never expose the key to:
- Browser JavaScript
- HTML
- React loader data
- JSON API responses
- Source maps
- Logs
- Git
- Error messages

Create a typed API client with:
- Request timeout
- Retry handling
- 429 handling
- Retry-After support
- Exponential backoff with jitter
- API error normalization
- Structured logging
- Response validation
- Pagination
- Abort support
- Request counting
- Daily budget protection

Use a maximum page size supported by the current API documentation.

Catalog search used by normal visitors must query D1, not the external API.

Initial catalog synchronization:
1. Fetch all sets
2. Upsert sets
3. Fetch all cards using pagination
4. Normalize card data
5. Upsert cards
6. Normalize all available prices
7. Upsert current prices
8. Record synchronization metrics
9. Continue safely after individual malformed records
10. Mark a complete sync only after all pages succeed

Daily synchronization:
- Refresh the catalog in paginated batches
- Use queues where available
- Use D1-backed jobs as fallback
- Make every page job idempotent
- Keep a sync cursor
- Prevent duplicate concurrent full syncs
- Use a distributed lock with expiry
- Recover abandoned jobs
- Do not delete a card after one missing API response
- Mark potentially removed cards inactive only after repeated complete sync absence

Cache external responses only where useful.

Do not perform an external API request on every card page view.

When the external API is unavailable:
- Serve the most recent D1 data
- Show the source update timestamp
- Log the error
- Keep the public site functioning

==================================================
16. PRICE NORMALIZATION
==================================================

Store all source prices separately.

Never combine TCGplayer USD and Cardmarket EUR into a single numeric value without explicit currency conversion.

Primary USD valuation:

For each available TCGplayer variant, choose:
1. market
2. mid
3. low

Store:
- low
- mid
- high
- market
- directLow
- selected normalized value
- source update date
- Pokector observation date

Optional EUR valuation:

For Cardmarket, choose:
1. trendPrice
2. averageSellPrice
3. lowPrice

Store Cardmarket values separately in EUR.

Default user portfolio valuation:
USD using TCGplayer.

If an item does not have an available price for its selected variant:
- Mark it unpriced
- Do not silently use another variant
- Offer the user an explicit option to change the selected variant

All money stored in D1 must use integer minor units.

Convert external decimal values to minor units using a tested decimal-safe parser.

Do not calculate money using JavaScript binary floating point.

==================================================
17. PRICE HISTORY
==================================================

Create price history only from real observations collected by Pokector.

Track price history for:
- Cards present in any user collection
- Cards present in any wishlist
- Cards recently viewed often enough to be considered popular
- Cards needed for public price-mover pages

Do not necessarily store daily history for every inactive catalog card forever.

Use a tracked-card reference table.

For each tracked card and variant:
- Insert at most one observation per source, currency, and calendar day
- Use a unique database constraint
- Store a new value when the normalized price changes
- Allow chart code to carry the last known value forward
- Store the observation timestamp
- Store the source's own updatedAt date separately

Retention:
- Keep daily observations for at least 400 days
- Aggregate older history into monthly observations
- Do not remove the only historical value for a period
- Implement a scheduled retention job
- Document retention behavior

Card chart ranges:
- 7D
- 1M
- 3M
- 6M
- 1Y
- MAX

If only one observation exists, display one point and an honest empty-history message.

==================================================
18. PORTFOLIO HISTORY
==================================================

Create daily portfolio snapshots.

Snapshot fields include:
- User ID
- Snapshot date
- Currency
- Market value
- Covered cost basis
- Unrealized profit or loss
- Unique card count
- Total quantity
- Priced entry count
- Unpriced entry count
- Calculation timestamp

Use a unique constraint for user, date, and currency.

Snapshots must be:
- Idempotent
- Recalculable
- Created after price synchronization
- Updated after significant same-day collection changes
- Never generated for dates before the user began tracking

For inactive users, avoid unnecessary repeated calculations when the portfolio has not changed.

For active users, keep daily history.

Aggregate older portfolio snapshots to monthly points when appropriate and documented.

==================================================
19. DATABASE SCHEMA
==================================================

Use Drizzle schema and SQL migrations.

Use Better Auth's generated or documented schema for:
- user
- session
- account
- verification

Create application tables equivalent to:

user_profiles
- user_id primary key and foreign key
- role
- display_name
- username
- default_currency
- locale
- timezone
- theme
- onboarding_completed
- created_at
- updated_at

pokemon_sets
- id primary key using external set ID
- slug unique
- name
- name_normalized
- series
- printed_total
- total
- release_date
- symbol_url
- logo_url
- source_updated_at
- synced_at
- active

pokemon_cards
- id primary key using external card ID
- slug unique
- set_id foreign key
- name
- name_normalized
- number
- number_sort
- supertype
- subtypes_json
- hp
- types_json
- rarity
- artist
- national_pokedex_numbers_json
- regulation_mark
- image_small_url
- image_large_url
- tcgplayer_url
- cardmarket_url
- search_text
- source_updated_at
- synced_at
- active

card_prices_current
- card_id
- source
- variant
- currency
- normalized_price_minor
- low_minor
- mid_minor
- high_minor
- market_minor
- direct_low_minor
- trend_minor
- average_sell_minor
- source_updated_at
- observed_at
- primary key or unique constraint across card_id, source, variant, currency

tracked_cards
- card_id primary key
- collection_reference_count
- wishlist_reference_count
- popularity_score
- last_viewed_at
- last_history_at
- updated_at

card_price_history
- id
- card_id
- source
- variant
- currency
- price_minor
- recorded_date
- observed_at
- source_updated_at
- unique constraint across card_id, source, variant, currency, recorded_date

collection_entries
- id
- user_id
- card_id
- quantity
- variant
- condition
- language
- purchase_price_minor nullable
- purchase_currency
- purchase_date nullable
- notes nullable
- created_at
- updated_at

binders
- id
- user_id
- name
- description
- visibility
- public_slug nullable unique
- created_at
- updated_at

binder_slots
- id
- binder_id
- collection_entry_id nullable
- card_id nullable
- page_number
- side
- slot_number
- created_at
- updated_at
- unique constraint across binder_id, page_number, side, slot_number

wishlist_items
- id
- user_id
- card_id
- variant
- target_price_minor nullable
- currency
- alert_direction
- alert_enabled
- prior_threshold_state
- last_alerted_at
- created_at
- updated_at
- unique constraint across user_id, card_id, variant, currency

set_goals
- id
- user_id
- set_id
- checklist_mode
- target_date nullable
- pinned
- created_at
- updated_at
- unique constraint across user_id, set_id, checklist_mode

set_progress_cache
- user_id
- set_id
- checklist_mode
- owned_count
- total_count
- missing_count
- missing_value_minor nullable
- calculated_at
- unique constraint across user_id, set_id, checklist_mode

portfolio_snapshots
- id
- user_id
- snapshot_date
- currency
- market_value_minor
- cost_basis_minor
- unrealized_pl_minor
- unique_card_count
- total_quantity
- priced_entry_count
- unpriced_entry_count
- calculated_at
- unique constraint across user_id, snapshot_date, currency

notifications
- id
- user_id
- type
- title
- message
- payload_json
- read_at nullable
- created_at

price_alert_events
- id
- wishlist_item_id
- card_id
- user_id
- price_minor
- currency
- delivery_in_app
- delivery_email
- delivery_error nullable
- triggered_at

import_jobs
- id
- user_id
- status
- mode
- total_rows
- processed_rows
- successful_rows
- failed_rows
- error_report_json
- created_at
- started_at
- completed_at

sync_jobs
- id
- type
- status
- cursor
- payload_json
- attempt_count
- locked_until
- error_message
- created_at
- started_at
- completed_at

sync_job_logs
- id
- job_id
- level
- event
- metadata_json
- created_at

admin_audit_logs
- id
- admin_user_id
- action
- target_type
- target_id
- metadata_json
- created_at

Use foreign keys with appropriate cascading behavior.

Do not cascade-delete shared catalog cards when a user is deleted.

Create indexes for all hot query paths, including:
- cards by set
- cards by normalized name
- cards by rarity
- cards by set and card number
- collection by user
- collection by user and card
- collection by updated date
- price history by card, variant, source, and date
- portfolio snapshots by user and date
- wishlist by user
- wishlist by card
- binder slots by binder and page
- notifications by user and read state
- sync jobs by status and lock expiry

Use EXPLAIN QUERY PLAN for major queries.

Do not use SELECT * in production hot paths.

==================================================
20. JSON API
==================================================

Create a versioned same-origin API under:
/api/v1

Required public endpoints:
- GET /api/v1/cards
- GET /api/v1/cards/:id
- GET /api/v1/cards/:id/prices
- GET /api/v1/cards/:id/price-history
- GET /api/v1/sets
- GET /api/v1/sets/:id
- GET /api/v1/price-movers

Required authenticated endpoints:
- GET /api/v1/me
- GET /api/v1/collection
- POST /api/v1/collection
- PATCH /api/v1/collection/:id
- DELETE /api/v1/collection/:id
- POST /api/v1/collection/bulk
- GET /api/v1/portfolio
- GET /api/v1/portfolio/history
- GET /api/v1/binders
- POST /api/v1/binders
- PATCH /api/v1/binders/:id
- DELETE /api/v1/binders/:id
- PUT /api/v1/binders/:id/slots
- GET /api/v1/sets/:id/progress
- GET /api/v1/wishlist
- POST /api/v1/wishlist
- PATCH /api/v1/wishlist/:id
- DELETE /api/v1/wishlist/:id
- GET /api/v1/notifications
- PATCH /api/v1/notifications/:id/read
- POST /api/v1/import/preview
- POST /api/v1/import/commit
- GET /api/v1/import/:jobId
- GET /api/v1/export

Required admin endpoints:
- GET /api/v1/admin/status
- POST /api/v1/admin/sync/catalog
- POST /api/v1/admin/sync/prices
- POST /api/v1/admin/snapshots
- GET /api/v1/admin/jobs
- POST /api/v1/admin/jobs/:id/retry
- GET /api/v1/admin/errors
- GET /api/v1/admin/users
- GET /api/v1/admin/audit-log

Use:
- Zod validation
- Consistent error schema
- Appropriate HTTP status codes
- Request IDs
- Cursor pagination
- Maximum page-size limits
- Authentication middleware
- Admin authorization middleware
- Origin validation for state-changing requests
- Rate limiting
- Content-type validation

Do not expose stack traces in production.

==================================================
21. ADMINISTRATION
==================================================

Create a protected administration interface at /admin.

Admin dashboard must show:
- Total users
- Active users
- Total collection entries
- Total catalog cards
- Total sets
- Total tracked cards
- Latest successful catalog sync
- Latest price sync
- Queue or job backlog
- Failed jobs
- Daily Pokémon API request count
- Estimated remaining request budget
- Cards with missing prices
- Cards with stale prices
- Email provider status
- Turnstile status
- D1 status
- KV status
- Environment name
- Application version

Admin actions:
- Start catalog sync
- Start price sync
- Start portfolio snapshot job
- Retry failed job
- Cancel safely cancellable job
- Rebuild set progress cache
- Recalculate a user's portfolio by user ID
- View sanitized API errors
- View audit log

Do not expose:
- Password hashes
- Session tokens
- API keys
- Full secret values
- Private user notes unless explicitly required for a user support request

All admin mutations must create audit records.

==================================================
22. SECURITY REQUIREMENTS
==================================================

Follow current Cloudflare Workers and web security best practices.

Required:
- Strict TypeScript
- No any in platform bindings or security-sensitive code
- No unsafe double casts
- No mutable request state in module globals
- No Math.random for IDs or tokens
- Use crypto.randomUUID or secure random values
- Await, return, void, or pass every promise to ctx.waitUntil
- Do not leave floating promises
- Use in-process Cloudflare bindings rather than calling the Cloudflare REST API from the Worker
- Explicit error handling
- Structured errors
- Secure cookies
- SameSite cookie protection
- Origin and host validation
- CSRF protection for state changes
- Content Security Policy
- Referrer-Policy
- Permissions-Policy
- X-Content-Type-Options
- Frame protection
- HSTS in production
- Output encoding
- Plain-text notes only
- Parameterized SQL through Drizzle or prepared statements
- File size limits
- CSV parser limits
- Rate limits
- Account lockout or progressive backoff
- Turnstile on high-risk forms
- Session revocation after password change
- Re-authentication for account deletion
- User data isolation tests
- Admin authorization tests
- No PII in structured logs
- Secret redaction
- Dependency audit

CSP must allow only required origins.

Card images may be loaded from the Pokémon TCG image host returned by the API.

Do not allow arbitrary remote image hosts from user input.

Create a security.txt route or static file.

Create a threat model in docs/SECURITY.md covering:
- Account takeover
- Credential stuffing
- Broken object-level authorization
- SQL injection
- XSS
- CSRF
- CSV injection
- API-key leakage
- Abuse of imports
- Abuse of search
- Queue duplication
- Price-data corruption
- Admin privilege escalation
- Enumeration of private binders
- Public share-link guessing

==================================================
23. SEO REQUIREMENTS
==================================================

Public pages must use server-side rendering.

Implement:
- Unique title tags
- Unique meta descriptions
- Canonical URLs
- Open Graph metadata
- Twitter card metadata
- Breadcrumb navigation
- BreadcrumbList structured data
- Appropriate CollectionPage and ItemList structured data
- robots.txt
- Sitemap index
- Chunked card sitemaps
- Chunked set sitemaps
- Blog sitemap
- Last-modified dates
- RSS feed
- Clean slugs
- Permanent redirects for changed slugs
- 404 page
- 410 handling for intentionally removed content
- noindex for authenticated pages
- noindex for internal search-result parameter combinations
- noindex for staging
- noindex for admin pages

Avoid:
- Doorway pages
- Thin automatically generated text
- Keyword stuffing
- Indexing every filter combination
- Duplicate set and card URLs
- Fake review markup
- Fake offer data

Card pages must contain useful factual content from the catalog and pricing database rather than only a title and image.

Create a dynamic sitemap architecture that can handle the complete catalog.

Use pokector.com as the production canonical host.

Redirect:
- www.pokector.com to pokector.com
- HTTP to HTTPS
- Duplicate trailing-slash variants consistently

==================================================
24. PERFORMANCE AND 10,000-USER READINESS
==================================================

Design for at least:
- 10,000 registered users
- Hundreds of daily active users
- At least 1,000,000 collection entries
- Tens of thousands of catalog cards
- Multiple years of aggregated history

This is a design and test target, not a guarantee of zero-cost infrastructure.

Optimize for low Cloudflare usage and free-first operation.

Do not make claims about current free-plan quotas until verifying official current Cloudflare documentation.

Document current limits in docs/COST_AND_SCALING.md with retrieval date.

Performance requirements:
- Cache public HTML where safe
- Use Cloudflare Cache API or supported framework caching
- Cache public catalog responses
- Do not cache private user data publicly
- Use stale-while-revalidate where appropriate
- Use KV for non-relational cache and lightweight rate-limit state
- Use D1 for relational source-of-truth data
- Use queues or background jobs for expensive writes
- Use indexed pagination
- Do not return unbounded lists
- Do not load all portfolio history for short ranges
- Lazy-load card images
- Use responsive images where possible
- Do not copy card images into D1 or R2
- Compress JSON and static assets
- Split client bundles
- Keep public pages useful without excessive client JavaScript
- Avoid N+1 queries
- Batch D1 writes using currently supported D1 APIs
- Measure important queries
- Record query plans
- Create database maintenance and retention jobs

Implement configurable abuse limits:
- Maximum collection entries per user
- Maximum binders per user
- Maximum wishlist items per user
- Maximum CSV rows
- Maximum import size
- Maximum search rate
- Maximum export rate

Use generous but finite defaults suitable for normal collectors.

Create a local synthetic data generator capable of producing:
- 10,000 test users
- 1,000,000 collection entries
- Portfolio snapshots
- Wishlist records
- Binder records

Do not run this generator against production.

Create a performance test script and document measured local or staging results.

==================================================
25. OBSERVABILITY AND RELIABILITY
==================================================

Enable Cloudflare observability using current supported configuration.

Use structured JSON logs containing:
- Request ID
- Environment
- Route
- Status
- Duration
- Error code
- Job ID where relevant

Do not log:
- Passwords
- Session tokens
- API keys
- Full authorization headers
- Personal notes
- Full imported CSV data

Implement:
- Global React error boundary
- Route error boundaries
- API error normalization
- Health endpoint
- Database health check
- Last-sync status
- Job retry policy
- Dead-letter or failed-job handling
- Idempotency keys for background operations
- Lock expiry
- Graceful API-dependency degradation

The /health endpoint must not expose sensitive configuration.

==================================================
26. TESTING
==================================================

Create automated tests for all critical behavior.

Unit tests:
- Decimal-to-minor-unit parsing
- TCGplayer price selection
- Cardmarket price selection
- Variant mapping
- Missing-price handling
- Portfolio market value
- Cost basis
- Profit and loss
- ROI
- Pricing coverage
- Set completion
- Missing-set cost
- Alert crossing behavior
- Alert cooldown
- CSV escaping
- CSV formula-injection protection
- Slug generation
- Pagination
- Permissions helpers

Integration tests:
- D1 migrations
- Auth session handling
- User data isolation
- Collection CRUD
- Binder ownership
- Binder public privacy
- Wishlist CRUD
- Portfolio endpoint
- Price history endpoint
- Admin authorization
- Catalog sync fixture
- Idempotent sync
- Queue retry
- Import preview and commit
- Account deletion cascade

End-to-end tests:
- Browse homepage
- Search public catalog
- Open card page
- Register
- Log in
- Complete onboarding
- Add card to collection
- Edit quantity and purchase price
- View updated portfolio
- Create binder
- Place card into binder slot
- View set progress
- Add missing card to wishlist
- Set price alert
- Export collection
- Import valid CSV
- Reject invalid CSV
- Prevent access to another user's collection
- Admin login and sync action
- Mobile navigation
- Dark mode
- Logout

Accessibility tests:
- Homepage
- Catalog
- Card page
- Dashboard
- Collection form
- Binder controls
- Auth forms

Use mocked Pokémon API fixtures for deterministic automated tests.

Add an optional real API smoke test that runs only when the API secret is available.

Before declaring completion, all must pass:
- pnpm lint
- pnpm typecheck
- pnpm test
- pnpm test:integration
- pnpm test:e2e
- pnpm build
- wrangler types --check
- wrangler check, or the current official equivalent
- wrangler deploy --dry-run

==================================================
27. CI AND GIT
==================================================

Initialize Git if needed.

Create:
- .gitignore
- .editorconfig
- .nvmrc
- pnpm-lock.yaml
- GitHub Actions workflow
- Dependabot configuration if appropriate
- Pull request template
- Issue templates

CI must run:
- Install with frozen lockfile
- Lint
- Format check
- Typecheck
- Unit tests
- Integration tests
- Build
- Wrangler dry-run validation

Do not deploy pull requests to production.

Support:
- Local environment
- Staging environment
- Production environment

Use small logical commits after each passing implementation phase when Git identity is configured.

Do not commit broken intermediate states unless required for recovery.

==================================================
28. DEPLOYMENT
==================================================

Use Cloudflare MCP and Wrangler to create or configure required resources.

Deployment order:
1. Local build and tests
2. Local D1 migrations
3. Staging resources
4. Staging migrations
5. Staging deployment
6. Staging catalog fixture or controlled real sync
7. Staging smoke tests
8. Production resources
9. Production migrations
10. Production secret verification
11. Production deployment
12. Production health check
13. Domain attachment where safe
14. Production smoke tests

Do not attach pokector.com if:
- The zone is unavailable
- Ownership is not verified
- A conflicting Worker route exists
- Existing DNS would be overwritten
- Required legal operator details are missing
- Required production secrets are missing

In that situation:
- Keep the working deployment on a safe URL
- Document exact remaining actions
- Do not claim the custom domain is live

When the zone is available and safe:
- Attach pokector.com
- Configure www redirect
- Preserve unrelated DNS records
- Verify HTTPS
- Verify canonical redirects
- Verify robots.txt
- Verify sitemap
- Verify auth cookies
- Verify Turnstile
- Verify public card images
- Verify no secret is present in client bundles

Create a release version and deployment summary.

==================================================
29. EXECUTION PHASES
==================================================

Execute these phases in order.

Phase 0:
- Repository and Cloudflare inspection
- Current official documentation verification
- Architecture and implementation plan
- Status checklist
- No stopping after the plan

Phase 1:
- Cloudflare React Router scaffold
- TypeScript strict configuration
- Tailwind and design system
- Wrangler configuration
- Environment structure
- CI foundation

Phase 2:
- Drizzle schema
- Better Auth schema
- Migrations
- D1 local setup
- Database repositories
- Seed fixtures

Phase 3:
- Authentication
- Roles
- Turnstile
- Security headers
- Session middleware
- Account settings

Phase 4:
- Pokémon TCG API client
- Normalization
- Catalog synchronization
- Queue and fallback job system
- Admin synchronization UI

Phase 5:
- Public card and set catalog
- Search and filters
- Card pages
- Set pages
- SEO, sitemaps, metadata, RSS

Phase 6:
- Collection CRUD
- Portfolio calculations
- Portfolio snapshots
- Dashboard
- Charts

Phase 7:
- Binders
- Set completion
- Wishlist
- Price alerts
- Notifications

Phase 8:
- CSV import and export
- Account data export
- Account deletion
- Admin dashboards and audit logs

Phase 9:
- Unit tests
- Integration tests
- E2E tests
- Accessibility tests
- Security review
- Performance review
- Synthetic scale tests

Phase 10:
- Staging deployment
- Smoke tests
- Bug fixes
- Production deployment where safe
- Final documentation

After every phase:
- Update IMPLEMENTATION_STATUS.md
- Run relevant linting and tests
- Fix failures before continuing
- Review complete changed files, not only diffs
- Check for TODO, FIXME, placeholder, and mock production data
- Record decisions
- Create a logical commit when possible

==================================================
30. DEFINITION OF DONE
==================================================

Do not call the project finished unless all applicable requirements below are true:

- Public SSR website works
- Catalog search uses D1
- Card pages work
- Set pages work
- Authentication works
- Turnstile integration works or is clearly blocked by missing external keys
- User collection works
- Portfolio calculations are tested
- Portfolio chart works
- Price history chart works with honest history states
- Binders work
- Set completion works
- Wishlist works
- In-app alerts work
- Optional email alerts degrade honestly when unavailable
- CSV import works
- CSV export works
- Account export works
- Account deletion works
- Admin panel works
- Catalog sync is idempotent
- Scheduled jobs work
- Failed jobs are recoverable
- User data is isolated
- Admin routes are protected
- Secrets are absent from source and client bundles
- Public pages have metadata
- Sitemap works
- robots.txt works
- Staging is noindex
- Mobile layout works
- Dark and light mode work
- Accessibility tests pass
- Unit tests pass
- Integration tests pass
- E2E tests pass
- Build passes
- Wrangler validation passes
- Staging smoke tests pass
- Production deployment is completed where external prerequisites allow it
- Documentation is complete
- Known limitations are explicit
- No fake price history exists
- No Collectr design or text is copied

==================================================
31. FINAL RESPONSE FORMAT
==================================================

At the end, provide a concise but complete report containing:

1. Production URL
2. Staging URL
3. Deployment status
4. Cloudflare resources created
5. Database migrations applied
6. Features implemented
7. Automated test results
8. Security checks completed
9. Performance checks completed
10. Catalog synchronization status
11. Required secrets that are configured
12. Required secrets that remain missing, without revealing values
13. Domain or DNS actions still required
14. Legal information still requiring operator review
15. Known limitations
16. Exact commands for local development
17. Exact commands for staging deployment
18. Exact commands for production deployment
19. Exact command for granting the first admin
20. Important file locations
