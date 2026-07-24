/**
 * CSRF defense-in-depth: verify a state-changing request came from our own site.
 *
 * Standard "Origin header" check. A cross-site browser POST always carries an
 * `Origin` header (the browser sets it and a page cannot forge it), so a present
 * but mismatched Origin is rejected. A *missing* Origin is not a CSRF vector —
 * server-to-server webhooks (Stripe, eBay) and non-browser clients send none, and
 * a CSRF attack requires a victim's browser (which would send Origin) — so it
 * passes. Safe methods (GET/HEAD/OPTIONS) never mutate, so they pass too.
 *
 * This layers on top of the `SameSite=Lax` session/preference cookies; neither
 * alone is relied upon.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isTrustedOrigin(request: Request, appUrl: string): boolean {
  if (SAFE_METHODS.has(request.method)) return true;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(appUrl).origin;
  } catch {
    return false; // malformed Origin header → reject
  }
}
