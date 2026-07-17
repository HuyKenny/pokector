/**
 * Security headers applied to every HTML/JSON response the Worker renders.
 * Card images are allowed only from the Pokémon TCG API image host; Turnstile
 * needs its challenge origin for script + frame. See docs/SECURITY.md.
 *
 * Script CSP:
 * - secure (staging/production): `'self' 'nonce-<per-request>'` — every inline
 *   script (React Router hydration data + our theme script) carries the nonce.
 * - development: `'self' 'unsafe-inline'` — Vite injects unnonced HMR/refresh
 *   inline scripts; dev is never public, so this is an accepted local relaxation.
 */

/** Image hosts the Pokémon TCG API returns for card/set artwork. The API moved
 * newer sets (me2pt5+) to images.scrydex.com — both hosts must be allowed or
 * the browser blocks the images (seen live on /sets/pitch-black-me5). */
const PTCG_IMAGE_HOSTS = ["https://images.pokemontcg.io", "https://images.scrydex.com"];
const TURNSTILE_HOST = "https://challenges.cloudflare.com";

export interface SecurityOptions {
  /** true for staging + production (strict, nonce-based CSP + HSTS-eligible). */
  secure: boolean;
  /** true only in production (adds HSTS). */
  production: boolean;
  nonce: string;
}

export function contentSecurityPolicy(options: SecurityOptions): string {
  const scriptSrc = options.secure
    ? `script-src 'self' 'nonce-${options.nonce}' ${TURNSTILE_HOST}`
    : `script-src 'self' 'unsafe-inline' ${TURNSTILE_HOST}`;

  return [
    "default-src 'self'",
    `img-src 'self' ${PTCG_IMAGE_HOSTS.join(" ")} data:`,
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    `frame-src ${TURNSTILE_HOST}`,
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function applySecurityHeaders(response: Response, options: SecurityOptions): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", contentSecurityPolicy(options));
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("X-Frame-Options", "DENY");
  if (options.production) {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
