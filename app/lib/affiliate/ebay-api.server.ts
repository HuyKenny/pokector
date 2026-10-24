/**
 * eBay Browse API — live "buy it from $X" prices for a card (raw + PSA 10),
 * shown on the card page next to the affiliate button.
 *
 * The naive "cheapest match" is noisy (stickers, magnets, fan-art, keychains,
 * code cards, lots), so we query the exact card (name + number + set) and drop
 * obvious non-single-card / mis-graded listings before taking the lowest price.
 *
 * Everything is cached in D1 (not KV — Free-plan write cap): the OAuth app token
 * (~2 h) and per-card prices (24 h). A missing/stale card entry triggers a
 * background refresh (ctx.waitUntil) so page renders never block on eBay, and a
 * daily refresh budget protects the Browse API rate limit. Disabled (returns
 * null) when no keyset is configured.
 */
import { lt } from "drizzle-orm";

import { incrementCounter, readCounter } from "../counters.server";
import { schema, type Database } from "../db/index.server";

/** A graded (PSA) market value with its provenance. `source='sold'` = median of
 * real 90-day sold comps (eBay Marketplace Insights) with a low/high range and
 * sample size — the "true" market value. `source='listing'` = trimmed median of
 * current active listings (outliers dropped) with range + sample size, used
 * until Insights access is granted. */
export interface GradedStat {
  /** Headline value (minor USD): sold median, or trimmed listing median. */
  valueMinor: number;
  lowMinor: number | null;
  highMinor: number | null;
  sampleSize: number | null;
  source: "sold" | "listing";
}

export interface EbayCardPrices {
  /** Lowest active listings ("from $X") — power the "Buy on eBay" CTA buttons. */
  rawFromMinor: number | null;
  psa9FromMinor: number | null;
  psa10FromMinor: number | null;
  /** Market values for the price table + collection valuation (sold median when available). */
  psa9: GradedStat | null;
  psa10: GradedStat | null;
}

/** eBay category "CCG Individual Cards" — narrows results to single cards. */
const CCG_CATEGORY = "183454";
const PRICE_TTL_SEC = 24 * 60 * 60;
const TOKEN_KEY = "ebay:token";
const INSIGHTS_TOKEN_KEY = "ebay:token:insights";
/** Short-lived marker set when the Insights token is refused (app not yet
 * approved for the limited-release API) so we don't hammer the token endpoint. */
const INSIGHTS_OFF_KEY = "ebay:insights:off";
const BROWSE_SCOPE = "https://api.ebay.com/oauth/api_scope";
const INSIGHTS_SCOPE = "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights";
const DAILY_REFRESH_CAP = 1500; // ≤5 eBay calls each ≈ under the daily limits

/** Listings that are clearly not the raw single card we're pricing. */
const NOISE =
  /\b(sticker|magnet|metal|fan\s?art|custom|proxy|key\s?chain|keychain|mini\s?slab|playing\s?card|code\s?card|digital|online|lot|bundle|jumbo|oversized|display|gift|plush|toy|coin|pin|charm|repro|replica|holder|sleeve|binder|case)\b/i;
/** Graded markers — excluded from the RAW price (kept for the PSA 10 lookup). */
const GRADED = /\b(psa|bgs|cgc|sgc|ace|tag|graded|gem\s?mint)\b/i;

const nowSec = () => Math.floor(Date.now() / 1000);
const isSandbox = (env: Env) => (env.EBAY_APP_ID ?? "").includes("-SBX-");
const apiHost = (env: Env) =>
  isSandbox(env) ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";

async function cacheGet(db: Database, key: string): Promise<string | null> {
  try {
    const row = await db.query.ebayCache.findFirst({ where: (t, { eq: e }) => e(t.key, key) });
    if (!row || row.expiresAt < nowSec()) return null;
    return row.value;
  } catch {
    return null;
  }
}

async function cacheSet(db: Database, key: string, value: string, ttlSec: number): Promise<void> {
  try {
    await db
      .insert(schema.ebayCache)
      .values({ key, value, expiresAt: nowSec() + ttlSec })
      .onConflictDoUpdate({
        target: schema.ebayCache.key,
        set: { value, expiresAt: nowSec() + ttlSec },
      });
  } catch {
    // best-effort cache
  }
}

/** Request an OAuth client-credentials application token for `scope`. */
async function requestAppToken(
  env: Env,
  scope: string,
): Promise<{ token: string; ttl: number } | null> {
  if (!env.EBAY_APP_ID || !env.EBAY_CERT_ID) return null;
  const basic = btoa(`${env.EBAY_APP_ID}:${env.EBAY_CERT_ID}`);
  const res = await fetch(`${apiHost(env)}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: "grant_type=client_credentials&scope=" + encodeURIComponent(scope),
  });
  if (!res.ok) return null;
  const data: { access_token?: string; expires_in?: number } = await res.json();
  if (!data.access_token) return null;
  return { token: data.access_token, ttl: Math.max(60, (data.expires_in ?? 7200) - 120) };
}

/** Cached OAuth token for the Browse API (base scope). */
async function getToken(env: Env, db: Database): Promise<string | null> {
  const cached = await cacheGet(db, TOKEN_KEY);
  if (cached) return cached;
  try {
    const got = await requestAppToken(env, BROWSE_SCOPE);
    if (!got) return null;
    await cacheSet(db, TOKEN_KEY, got.token, got.ttl);
    return got.token;
  } catch {
    return null;
  }
}

/**
 * Cached OAuth token for the Marketplace Insights API (sold comps). This is a
 * limited-release scope: until eBay grants the app access the token request is
 * refused, so we cache a short "off" marker and fall back to lowest-listing
 * prices. Once access is granted the token starts succeeding automatically.
 */
async function getInsightsToken(env: Env, db: Database): Promise<string | null> {
  const cached = await cacheGet(db, INSIGHTS_TOKEN_KEY);
  if (cached) return cached;
  if (await cacheGet(db, INSIGHTS_OFF_KEY)) return null; // not approved yet, don't retry hard
  try {
    const got = await requestAppToken(env, INSIGHTS_SCOPE);
    if (!got) {
      await cacheSet(db, INSIGHTS_OFF_KEY, "1", 3600);
      return null;
    }
    await cacheSet(db, INSIGHTS_TOKEN_KEY, got.token, got.ttl);
    return got.token;
  } catch {
    return null;
  }
}

interface Summary {
  title?: string;
  price?: { value?: string; currency?: string };
}

/** Robust value estimate over active-listing asking prices (minor units).
 * `lowestMinor` = the true cheapest listing (powers the "Buy from $X" CTA).
 * `estimateMinor` = the median AFTER trimming outliers off both ends, so a
 * single mis-titled/damaged lowball or a wildly overpriced listing can't skew
 * the value; `lowMinor`/`highMinor` are the trimmed bounds and `count` is the
 * full accepted sample size. This squeezes a representative value out of the
 * Browse API (active listings) — the one we actually have — instead of trusting
 * the single cheapest match. Pure + exported for unit tests. */
export interface ListingEstimate {
  estimateMinor: number;
  lowMinor: number;
  highMinor: number;
  count: number;
  lowestMinor: number;
}

export function robustListingEstimate(pricesMinor: number[]): ListingEstimate | null {
  const vals = pricesMinor.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (vals.length === 0) return null;
  const lowestMinor = vals[0];
  // Trim ~10% off each end once the sample is large enough to spare it; small
  // samples keep every point (nothing to safely discard).
  const trim = vals.length >= 8 ? Math.floor(vals.length * 0.1) : 0;
  const kept = trim > 0 ? vals.slice(trim, vals.length - trim) : vals;
  const mid = kept.length >> 1;
  const estimateMinor =
    kept.length % 2 === 1 ? kept[mid] : Math.round((kept[mid - 1] + kept[mid]) / 2);
  return {
    estimateMinor,
    lowMinor: kept[0],
    highMinor: kept[kept.length - 1],
    count: vals.length,
    lowestMinor,
  };
}

/** Robust listing estimate for a card (minor USD) among active listings matching
 * `query` that pass the `accept` predicate on their title. Null when none.
 * One Browse call; up to 100 results are mined from the single response. */
async function listingStats(
  env: Env,
  token: string,
  query: string,
  accept: (title: string) => boolean,
): Promise<ListingEstimate | null> {
  const params = new URLSearchParams({
    q: query,
    category_ids: CCG_CATEGORY,
    filter: "buyingOptions:{FIXED_PRICE}",
    sort: "price",
    limit: "100",
  });
  const url = `${apiHost(env)}/buy/browse/v1/item_summary/search?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
  });
  if (!res.ok) return null;
  const data: { itemSummaries?: Summary[] } = await res.json();
  const prices: number[] = [];
  for (const it of data.itemSummaries ?? []) {
    if ((it.price?.currency ?? "USD") !== "USD") continue;
    const value = Number(it.price?.value);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (!accept(it.title ?? "")) continue;
    prices.push(Math.round(value * 100));
  }
  return robustListingEstimate(prices);
}

interface Sale {
  title?: string;
  lastSoldPrice?: { value?: string; currency?: string };
}

/** Median / low / high / count of real USD sold prices (last 90 days, via the
 * Marketplace Insights API) among sales matching `query` that pass `accept`.
 * Null when the API is unavailable or nothing sold. This is the "true" market
 * value: a median over actual transactions, not a single cheapest listing. */
async function soldStats(
  env: Env,
  token: string,
  query: string,
  accept: (title: string) => boolean,
): Promise<{ medianMinor: number; lowMinor: number; highMinor: number; count: number } | null> {
  const params = new URLSearchParams({
    q: query,
    category_ids: CCG_CATEGORY,
    limit: "100",
  });
  const url = `${apiHost(env)}/buy/marketplace_insights/v1_beta/item_sales/search?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
  });
  if (!res.ok) return null;
  const data: { itemSales?: Sale[] } = await res.json();
  const vals: number[] = [];
  for (const s of data.itemSales ?? []) {
    if ((s.lastSoldPrice?.currency ?? "USD") !== "USD") continue;
    const value = Number(s.lastSoldPrice?.value);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (!accept(s.title ?? "")) continue;
    vals.push(Math.round(value * 100));
  }
  if (vals.length === 0) return null;
  vals.sort((a, b) => a - b);
  const mid = vals.length >> 1;
  const medianMinor =
    vals.length % 2 === 1 ? vals[mid] : Math.round((vals[mid - 1] + vals[mid]) / 2);
  return { medianMinor, lowMinor: vals[0], highMinor: vals[vals.length - 1], count: vals.length };
}

/** Build the exact-card search phrase (name + number[/printedTotal] + set).
 * "Pokemon" is appended so generic card names (e.g. "Bill", "Energy") don't
 * over-match unrelated listings — same guard the affiliate query uses. */
function cardQuery(card: EbayCardRef): string {
  const number = card.printedTotal ? `${card.number}/${card.printedTotal}` : card.number;
  return [card.name, card.setName, number, "Pokemon"].filter(Boolean).join(" ");
}

export interface EbayCardRef {
  id: string;
  name: string;
  setName: string;
  number: string;
  printedTotal: number | null;
}

async function refresh(env: Env, db: Database, card: EbayCardRef): Promise<void> {
  // Check the budget WITHOUT incrementing first, so no-op-over-budget calls don't
  // inflate the counter past the cap (which would starve the seed job). Only count
  // a refresh once we actually proceed to call eBay.
  const day = new Date().toISOString().slice(0, 10);
  const used = await readCounter(db, `ebay:refresh:${day}`);
  if (used !== null && used >= DAILY_REFRESH_CAP) return; // protect the rate limit
  const token = await getToken(env, db);
  if (!token) return;
  await incrementCounter(db, `ebay:refresh:${day}`, PRICE_TTL_SEC); // reserve one refresh
  const base = cardQuery(card);
  const psa9Accept = (t: string) => /psa\s?9\b/i.test(t) && !NOISE.test(t);
  const psa10Accept = (t: string) => /psa\s?10\b/i.test(t) && !NOISE.test(t);
  // Robust listing estimates (trimmed median + range) over active listings.
  const [rawListing, psa9Listing, psa10Listing] = await Promise.all([
    // Raw = single card, not graded, not novelty.
    listingStats(env, token, base, (t) => !NOISE.test(t) && !GRADED.test(t)),
    // PSA 9 / PSA 10 = title must actually say that grade, minus novelty items.
    listingStats(env, token, `${base} PSA 9`, psa9Accept),
    listingStats(env, token, `${base} PSA 10`, psa10Accept),
  ]);
  // Lowest active listing powers the "Buy on eBay — from $X" CTA buttons.
  const rawFromMinor = rawListing?.lowestMinor ?? null;
  const psa9FromMinor = psa9Listing?.lowestMinor ?? null;
  const psa10FromMinor = psa10Listing?.lowestMinor ?? null;
  // Real 90-day sold comps (median + range) are the true market value. Requires
  // Marketplace Insights access; absent that, fall back to the listing estimate.
  const insToken = await getInsightsToken(env, db);
  const [psa9Sold, psa10Sold] = insToken
    ? await Promise.all([
        soldStats(env, insToken, `${base} PSA 9`, psa9Accept),
        soldStats(env, insToken, `${base} PSA 10`, psa10Accept),
      ])
    : [null, null];
  const psa9 = toStat(psa9Sold, psa9Listing);
  const psa10 = toStat(psa10Sold, psa10Listing);
  await cacheSet(
    db,
    `ebay:prices:v3:${card.id}`,
    JSON.stringify({
      rawFromMinor,
      psa9FromMinor,
      psa10FromMinor,
      psa9,
      psa10,
    } satisfies EbayCardPrices),
    PRICE_TTL_SEC,
  );
  // Persist graded market values so they can be valued in portfolios and
  // snapshotted into history (raw stays TCGplayer — not stored here).
  await persistGraded(db, card.id, "psa9", psa9);
  await persistGraded(db, card.id, "psa10", psa10);
}

/** Combine an optional sold-comps result with the listing estimate into a stat.
 * Sold comps (real transactions) always win; otherwise the trimmed-median
 * listing estimate carries a low/high range and sample size too. A range/sample
 * is only asserted with ≥2 listings — a lone listing is reported as a bare value. */
function toStat(
  sold: { medianMinor: number; lowMinor: number; highMinor: number; count: number } | null,
  listing: ListingEstimate | null,
): GradedStat | null {
  if (sold) {
    return {
      valueMinor: sold.medianMinor,
      lowMinor: sold.lowMinor,
      highMinor: sold.highMinor,
      sampleSize: sold.count,
      source: "sold",
    };
  }
  if (listing != null) {
    const hasRange = listing.count >= 2;
    return {
      valueMinor: listing.estimateMinor,
      lowMinor: hasRange ? listing.lowMinor : null,
      highMinor: hasRange ? listing.highMinor : null,
      sampleSize: listing.count,
      source: "listing",
    };
  }
  return null;
}

/** Upsert (or skip) a graded market value for a card. */
async function persistGraded(
  db: Database,
  cardId: string,
  grade: "psa9" | "psa10",
  stat: GradedStat | null,
): Promise<void> {
  try {
    if (stat == null) return;
    const row = {
      fromMinor: stat.valueMinor,
      lowMinor: stat.lowMinor,
      highMinor: stat.highMinor,
      sampleSize: stat.sampleSize,
      source: stat.source,
      observedAt: new Date(),
    };
    await db
      .insert(schema.cardGradedPrices)
      .values({ cardId, grade, currency: "USD", ...row })
      .onConflictDoUpdate({
        target: [
          schema.cardGradedPrices.cardId,
          schema.cardGradedPrices.grade,
          schema.cardGradedPrices.currency,
        ],
        set: row,
      });
  } catch {
    // best-effort
  }
}

/**
 * Cached eBay prices for a card. Returns cached data immediately; on a cache
 * miss schedules a background refresh and returns null (the page shows the plain
 * affiliate button until the next view). Null when eBay isn't configured.
 */
export async function getEbayCardPrices(
  env: Env,
  db: Database,
  waitUntil: (p: Promise<unknown>) => void,
  card: EbayCardRef,
): Promise<EbayCardPrices | null> {
  if (!env.EBAY_APP_ID || !env.EBAY_CERT_ID) return null;
  const cached = await cacheGet(db, `ebay:prices:v3:${card.id}`);
  if (cached) {
    try {
      return JSON.parse(cached) as EbayCardPrices;
    } catch {
      return null;
    }
  }
  waitUntil(refresh(env, db, card).catch(() => undefined));
  return null;
}

/** Delete expired eBay cache rows (daily cron housekeeping). */
export async function pruneExpiredEbayCache(db: Database): Promise<void> {
  await db.delete(schema.ebayCache).where(lt(schema.ebayCache.expiresAt, nowSec()));
}

/** Shared daily eBay Browse refresh cap (also used by the proactive seed job). */
export const EBAY_DAILY_REFRESH_CAP = DAILY_REFRESH_CAP;
/** D1 counter key for today's eBay refresh budget. */
export const ebayRefreshBudgetKey = (day: string) => `ebay:refresh:${day}`;

/**
 * Fetch + persist eBay prices for one card (raw + PSA 9 + PSA 10), the same as a
 * cache-miss refresh but callable from a server-side batch job (no request
 * context). Writes ebay_cache + card_graded_prices; self-limited by the shared
 * daily budget counter. See handleEbayGradedSeed.
 */
export async function refreshCardGradedPrices(
  env: Env,
  db: Database,
  card: EbayCardRef,
): Promise<void> {
  if (!env.EBAY_APP_ID || !env.EBAY_CERT_ID) return;
  await refresh(env, db, card);
}
