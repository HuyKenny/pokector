/**
 * Security headers applied to every HTML/JSON response the Worker renders.
 * Card images are allowed only from the Pokémon TCG API image host; Turnstile
 * needs its challenge origin for script + frame. See docs/SECURITY.md.
 */

import { THEME_SCRIPT_CSP_HASH } from "../theme";

const PTCG_IMAGE_HOST = "https://images.pokemontcg.io";
const TURNSTILE_HOST = "https://challenges.cloudflare.com";

export function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    `img-src 'self' ${PTCG_IMAGE_HOST} data:`,
    `script-src 'self' '${THEME_SCRIPT_CSP_HASH}' ${TURNSTILE_HOST}`,
    // Tailwind injects a <style> tag in dev; hashes are impractical for SSR-inlined
    // styles, and 'unsafe-inline' for styles (not scripts) is an accepted trade-off.
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

export function applySecurityHeaders(
  response: Response,
  options: { production: boolean },
): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", contentSecurityPolicy());
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
