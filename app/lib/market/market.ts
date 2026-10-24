/**
 * Market registry and helpers (client-safe — no server imports, so it bundles
 * into the client like i18n/locales.ts).
 *
 * A "market" is the price world the visitor sees, INDEPENDENT of language:
 *   - "us" → TCGplayer prices in USD (per-variant, low/mid/high)
 *   - "eu" → Cardmarket prices in EUR (trend/avgSell/low), more relevant for
 *     European collectors.
 *
 * Unlike locale (which is URL-based because Google indexes languages
 * separately), the market is a personalization preference stored in a COOKIE:
 * canonical URLs strip query strings and hreflang is a locale×path matrix, so a
 * market URL dimension would only bloat the SEO surface with no benefit.
 *
 * ⚠️ The default for a first-time visitor is `DEFAULT_MARKET`, NOT geolocation.
 * It used to fall back to `marketFromCountry(request.cf.country)`; that was
 * removed on 2026-09-23 because it made the HTML uncacheable — Cloudflare's
 * cache key is effectively just the URL (country and cookie components are
 * Enterprise-only), so a German and an American visitor with no cookie shared
 * one entry and one of them saw the wrong currency. Do not reintroduce a
 * per-visitor default without removing the edge cache in workers/html-cache.ts.
 * A `Vary` header does NOT help: Cloudflare does not key the cache on it.
 */

export const MARKETS = ["us", "eu"] as const;
export type Market = (typeof MARKETS)[number];

export const DEFAULT_MARKET: Market = "us";

/** Cookie that persists the visitor's chosen market. */
export const MARKET_COOKIE = "pk_market";

export type PriceSource = "tcgplayer" | "cardmarket";
export type Currency = "USD" | "EUR";

/** The price source each market reads from `card_prices_current` / history. */
export const MARKET_SOURCE: Record<Market, PriceSource> = {
  us: "tcgplayer",
  eu: "cardmarket",
};

/** The currency each market is denominated in. */
export const MARKET_CURRENCY: Record<Market, Currency> = {
  us: "USD",
  eu: "EUR",
};

/** Flag + short label for the switcher. */
export const MARKET_FLAG: Record<Market, string> = { us: "🇺🇸", eu: "🇪🇺" };

export function isMarket(value: unknown): value is Market {
  return typeof value === "string" && (MARKETS as readonly string[]).includes(value);
}

/** Coerce an arbitrary string (cookie value, form field) to a Market. */
export function resolveMarket(value: string | null | undefined): Market {
  return isMarket(value) ? value : DEFAULT_MARKET;
}

/**
 * Countries whose visitors default to the EU (Cardmarket/EUR) market: EU + EEA
 * + UK + Switzerland — Cardmarket's home turf. Everyone else defaults to US.
 */
export const EU_COUNTRIES: ReadonlySet<string> = new Set([
  // EU 27
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  // EEA
  "IS",
  "LI",
  "NO",
  // UK + Switzerland
  "GB",
  "CH",
]);

/**
 * Geolocation default: EU/EEA/UK/CH → "eu", otherwise "us".
 *
 * No longer used for the request default — see the module comment above. Kept
 * as a correct pure helper (the browser would want the same mapping if we ever
 * resolve the market client-side); nothing in the request path should call it.
 */
export function marketFromCountry(country: string | null | undefined): Market {
  return country && EU_COUNTRIES.has(country.toUpperCase()) ? "eu" : "us";
}

/** Read the market cookie value out of a raw Cookie header. */
export function marketFromCookieHeader(cookieHeader: string | null): Market | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, v] = part.split("=");
    if (k?.trim() === MARKET_COOKIE) return isMarket(v?.trim()) ? (v.trim() as Market) : null;
  }
  return null;
}
