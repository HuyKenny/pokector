/**
 * Edge cache for public HTML, via the Cache API.
 *
 * Why this exists rather than a Cache Rule: pokector.com is served by a Worker
 * on a custom domain, and Cloudflare's edge cache does NOT cache a response a
 * Worker constructs — a Cache Rule in front of it has no effect on HTML (a rule
 * created 2026-09-23 does cache /assets/*, which the assets binding serves, but
 * every HTML response came back without `cf-cache-status` at all). Caching has
 * to happen in code. Verified 2026-09-23; the project SPEC already asked for
 * "Cloudflare Cache API or supported framework caching" (§Performance).
 *
 * The safety argument, which is the whole reason the predicate below is strict:
 * the Cache API is keyed on the URL alone. Country- and cookie-based cache keys
 * are Enterprise-only features, so anything that changes the rendered bytes per
 * visitor MUST bypass the cache entirely — a shared entry would leak it.
 *
 * On pokector that means two things changed on 2026-09-23 before this could be
 * switched on:
 *   1. The market default no longer comes from geolocation (workers/app.ts), so
 *      a cookie-less visitor always gets DEFAULT_MARKET — identical bytes.
 *   2. Anyone carrying pk_market, pk_game or a session cookie skips the cache.
 * Do not relax either one without re-reading this comment.
 *
 * Two properties of the Cache API worth knowing:
 *   - It is per-data-center ("contents do not replicate outside of the
 *     originating data center"), so the hit rate is far below a global CDN's.
 *     Still the largest lever we have on Worker CPU.
 *   - `stale-while-revalidate` is not supported by cache.put — entries expire
 *     and are re-rendered rather than served stale.
 */
import { MARKET_COOKIE } from "../app/lib/market/market";
import { GAME_COOKIE } from "../app/lib/game/game";

/**
 * Named cache rather than `caches.default`: this project compiles with the DOM
 * lib, whose `CacheStorage` interface shadows the `default` getter that
 * `wrangler types` generates, so `caches.default` does not typecheck here
 * (verified 2026-09-23). `open()` is the same Cache API and is what the DOM
 * types do declare.
 */
const CACHE_NAME = "pokector-html";

/** Better Auth cookie names, from `advanced.cookiePrefix` in auth.server.ts. */
const SESSION_COOKIE_PREFIX = "pokector.session";

/**
 * Paths that are never cached, mirroring the route table in app/routes.ts.
 * Matched with or without a trailing slash: a bare `/admin` slipped past a
 * plain `startsWith("/admin/")` on staging (caught by the response check, but
 * the predicate should say what it means).
 */
const SKIP_PREFIXES = ["/app", "/admin", "/api"];
/** Suffixes covering both the bare and the /:locale/ variants of a page. */
const SKIP_SUFFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/logout",
  "/market",
  "/locale",
  "/game",
  "/health",
];

/**
 * True when this request may be served from, and written to, the shared cache.
 *
 * Deliberately conservative: a false negative costs a re-render, a false
 * positive serves one visitor's personalised page to another. When in doubt the
 * predicate answers "no".
 */
export function isCacheable(request: Request, url: URL): boolean {
  if (request.method !== "GET") return false;
  // `private` pages (binders) and anything under /app, /admin, /api.
  if (SKIP_PREFIXES.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) {
    return false;
  }
  if (url.pathname.includes("/binders/")) return false;
  if (SKIP_SUFFIXES.some((s) => url.pathname.endsWith(s))) return false;
  // Search results are per-query and rate-limited — leave them uncached.
  if (url.search.includes("q=")) return false;

  // Personalisation lives in cookies and is not part of the cache key.
  const cookie = request.headers.get("cookie");
  if (cookie) {
    if (cookie.includes(`${MARKET_COOKIE}=`)) return false;
    if (cookie.includes(`${GAME_COOKIE}=`)) return false;
    if (cookie.includes(SESSION_COOKIE_PREFIX)) return false;
  }
  return true;
}

/**
 * Whether a response is worth storing. Requires an explicit positive shared TTL
 * (`s-maxage`), so routes that say `private` or say nothing never enter the
 * cache even if the predicate above let them through — belt and braces.
 */
export function isStorable(response: Response): boolean {
  if (response.status !== 200) return false;
  // The Cache API refuses Set-Cookie responses anyway; skip them explicitly so
  // the intent is visible and we do not rely on that.
  if (response.headers.has("set-cookie")) return false;
  const cc = response.headers.get("cache-control") ?? "";
  if (/\bprivate\b|\bno-store\b/.test(cc)) return false;
  const m = /s-maxage=(\d+)/.exec(cc);
  return m !== null && Number(m[1]) > 0;
}

/**
 * Read from the cache. Returns a fresh Response (headers made mutable so the
 * caller can stamp a request id) or null on a miss.
 */
export async function readCache(request: Request): Promise<Response | null> {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(request);
  if (!hit) return null;
  const headers = new Headers(hit.headers);
  headers.set("X-Cache", "HIT");
  return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
}

/** Store a copy. Never throws — a cache failure must not fail the request. */
export async function writeCache(request: Request, response: Response): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response);
  } catch {
    // Ignore: worst case we render again next time.
  }
}
