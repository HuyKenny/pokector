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
/** TCGplayer product-image CDN — Riftbound card art is built from tcgplayerId
 * (JustTCG returns no image URLs). Same host for list + detail sizes. */
const TCGPLAYER_IMAGE_HOSTS = ["https://tcgplayer-cdn.tcgplayer.com"];
const TURNSTILE_HOST = "https://challenges.cloudflare.com";
/**
 * Where a checkout/portal redirect is allowed to land.
 *
 * Billing runs on Autumn, which hands back a **hosted Stripe** URL that we answer
 * with a 302 from our own form action. `'self'` alone is not enough: our Stripe
 * custom domain `pay.pokector.com` is a different origin (`'self'` never covers
 * subdomains), and Stripe's own hosts are used when the custom domain is not
 * applied to a given session.
 *
 * Chrome and Safari do not check `form-action` against redirects, but Firefox has
 * historically blocked exactly this shape — which would silently break "Go Pro"
 * for those visitors while everything looked fine in the logs. Listing the
 * destinations removes that whole class of failure.
 */
const PAYMENT_HOSTS = [
  "https://pay.pokector.com",
  "https://checkout.stripe.com",
  "https://billing.stripe.com",
];

/** Google Analytics 4 (gtag.js). Loaded only in production (see app/root.tsx),
 * so these origins are added to the CSP only when `production` is set. */
const GA_SCRIPT_HOST = "https://www.googletagmanager.com";
const GA_CONNECT_HOSTS = [
  "https://www.googletagmanager.com",
  "https://www.google-analytics.com",
  "https://*.google-analytics.com",
  "https://*.analytics.google.com",
];
const GA_IMAGE_HOSTS = ["https://www.googletagmanager.com", "https://*.google-analytics.com"];

export interface SecurityOptions {
  /** true for staging + production (strict, nonce-based CSP + HSTS-eligible). */
  secure: boolean;
  /** true only in production (adds HSTS). */
  production: boolean;
  nonce: string;
}

export function contentSecurityPolicy(options: SecurityOptions): string {
  const gaScript = options.production ? ` ${GA_SCRIPT_HOST}` : "";
  const gaConnect = options.production ? ` ${GA_CONNECT_HOSTS.join(" ")}` : "";
  const gaImg = options.production ? ` ${GA_IMAGE_HOSTS.join(" ")}` : "";

  const scriptSrc = options.secure
    ? `script-src 'self' 'nonce-${options.nonce}' ${TURNSTILE_HOST}${gaScript}`
    : `script-src 'self' 'unsafe-inline' ${TURNSTILE_HOST}${gaScript}`;

  return [
    "default-src 'self'",
    `img-src 'self' ${PTCG_IMAGE_HOSTS.join(" ")} ${TCGPLAYER_IMAGE_HOSTS.join(" ")} data:${gaImg}`,
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    `frame-src ${TURNSTILE_HOST}`,
    "font-src 'self'",
    `connect-src 'self'${gaConnect}`,
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' ${PAYMENT_HOSTS.join(" ")}`,
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
  // Isolate the browsing context (a cross-origin opener can't reach our window)
  // and refuse legacy Flash/PDF cross-domain policy files.
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("X-Permitted-Cross-Domain-Policies", "none");
  // Prevent other origins from embedding our responses as a subresource
  // (Spectre-class side-channel hardening). This governs how OUR resources may
  // be loaded elsewhere; it does not affect us loading Turnstile/GA, nor social
  // scrapers fetching the page as a top-level navigation. COEP is intentionally
  // NOT set — it can break the Turnstile iframe and GA and needs separate testing.
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  if (options.production) {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
