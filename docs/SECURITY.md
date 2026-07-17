# Pokector — Security

Last updated: 2026-07-17 (Phase 0 baseline; verified controls updated per phase)

## Principles

- Strict TypeScript; no `any` in bindings or security-sensitive code; no unsafe double casts.
- All user-owned queries filter by the **server-derived** authenticated user ID (from Better Auth session). No user ID is ever accepted from the client.
- All money/date/content inputs validated with Zod at the boundary.
- Secrets only via Worker secrets / `.dev.vars`; never in code, git, client bundles, loader data, or logs.
- IDs/tokens via `crypto.randomUUID()` / `crypto.getRandomValues()`; never `Math.random`.
- No floating promises: awaited, returned, or passed to `ctx.waitUntil`.
- In-process bindings (D1/KV) only; the Worker never calls the Cloudflare REST API.
- Parameterized SQL exclusively (Drizzle / prepared statements).

## HTTP security headers (all responses)

- `Content-Security-Policy`: `default-src 'self'`; `img-src 'self' https://images.pokemontcg.io https://images.scrydex.com data:`; `script-src 'self'` (+ Turnstile `https://challenges.cloudflare.com`); `frame-src https://challenges.cloudflare.com` (Turnstile only); `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'none'`.
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` (production only).
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `X-Frame-Options: DENY`.
- `/app`, `/admin`, `/api/v1` private responses: `Cache-Control: private, no-store`.

Card images come only from the PTCG image hosts (`images.pokemontcg.io`, and
`images.scrydex.com` used for newer sets) as returned by
the catalog — user input can never introduce another image origin.

## AuthN/AuthZ

- Better Auth: HTTP-only, Secure, SameSite=Lax signed cookies; sessions in KV
  (secondaryStorage); session revocation on password change/reset; fresh-session
  requirement (re-auth) for account deletion; native scrypt (node:crypto).
- Roles: `user` / `admin` via Better Auth admin plugin; role changes only server-side
  (`pnpm admin:grant` CLI or admin API with audit record). `input: false` — role can
  never be set from a client payload.
- Origin/Host validation on every state-changing request (same-origin app; Better
  Auth `trustedOrigins` + our middleware). CSRF protection: SameSite cookies + origin
  check + no cross-site CORS.
- Rate limits (KV): registration, login, password reset, verification resend, search,
  import, export, alert config, admin jobs. Progressive backoff on repeated auth
  failures. Turnstile on registration/login/password-reset forms.

## Threat model

| Threat                                   | Mitigations                                                                                                                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account takeover                         | scrypt password hashing, rate limits + progressive backoff, Turnstile, session revocation on password change, secure cookies, (email verification when provider configured)               |
| Credential stuffing                      | per-IP + per-identifier rate limits (cf-connecting-ip), Turnstile, no user-enumeration in error copy/timing on login & reset                                                              |
| Broken object-level authorization (BOLA) | every repository method takes `userId` from session; route params never trusted; isolation integration tests for collection/binders/wishlist/notifications/import jobs                    |
| SQL injection                            | Drizzle parameterized queries only; no string-built SQL; migrations reviewed                                                                                                              |
| XSS                                      | React auto-escaping; notes stored/rendered as plain text (no HTML/markdown rendering); strict CSP; JSON responses `nosniff`                                                               |
| CSRF                                     | SameSite=Lax cookies + Origin/Host validation on mutations + no wildcard CORS                                                                                                             |
| CSV injection                            | export cells starting with `= + - @ \t \r` prefixed with `'`; import treated as data only                                                                                                 |
| API-key leakage                          | PTCG key server-only (secret binding), never in loader data/logs/errors; client bundle scanned for secrets in CI/deploy checks                                                            |
| Import abuse                             | content-type + size caps, row caps, streaming parse limits, per-user import rate limit, background job isolation, error report capped                                                     |
| Search abuse                             | rate limit per IP, bounded page size, indexed queries only, no external API fan-out from search                                                                                           |
| Queue duplication                        | job execution idempotent; D1 is single source of truth; lease (`locked_until`) + attempt counter; unique constraints on observations/snapshots                                            |
| Price-data corruption                    | Zod validation of external API payloads; decimal-safe parsing; per-record failure isolation (skip + log malformed); unique constraints; complete-sync marker only after all pages succeed |
| Admin privilege escalation               | role checked server-side per request; admin routes/API double-guarded (session + role); no client-supplied role; audit log on every admin mutation; admin grant only via CLI/audited API  |
| Private binder enumeration               | binder access checks owner OR visibility; unlisted share slugs = 128-bit random (crypto), regenerable, revocable; 404 (not 403) for unauthorized guesses; no sequential IDs exposed       |
| Share-link guessing                      | 22-char base64url (128-bit) slugs; rate limit on public binder fetches; regenerate + disable controls                                                                                     |

## Logging & privacy

Structured JSON logs: request ID, environment, route, status, duration, error code,
job ID. Never logged: passwords, session tokens, API keys, full auth headers, personal
notes, full CSV contents, e-mail addresses (user IDs only). Error responses in
production expose a request ID, never a stack trace.

## security.txt

`/.well-known/security.txt` served with security contact (config var), expiry, canonical.

## Verification (Phase 9 fills in results)

- [x] User data isolation integration tests (collection/binders/wishlist BOLA + E2E foreign-binder 404)
- [x] Admin authorization (requireAdmin double-guard; 404 for non-admins; role only via CLI)
- [x] Client bundle secret scan — no secret values or `.server` modules in build/client (Phase 9, see COST_AND_SCALING.md)
- [x] Dependency audit (`pnpm audit --prod`) — 1 moderate, dev-only esbuild advisory, not production-reachable
- [x] Accessibility: axe-core WCAG 2.1 AA on home/cards/card/login/register/dashboard/collection — 0 serious/critical
- [x] CSP verified: strict nonce-based script-src in staging/production hydrates correctly; dev uses unsafe-inline (never public)
- [ ] Header/CSP verification on the live staging + production URLs (Phase 10 smoke tests)
