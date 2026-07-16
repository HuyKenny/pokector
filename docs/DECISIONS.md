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
