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

import { incrementCounter } from "../counters.server";
import { schema, type Database } from "../db/index.server";

export interface EbayCardPrices {
  rawFromMinor: number | null;
  psa9FromMinor: number | null;
  psa10FromMinor: number | null;
}

/** eBay category "CCG Individual Cards" — narrows results to single cards. */
const CCG_CATEGORY = "183454";
const PRICE_TTL_SEC = 24 * 60 * 60;
const TOKEN_KEY = "ebay:token";
const DAILY_REFRESH_CAP = 1500; // ×3 Browse calls each ≈ under the 5k/day limit

/** Listings that are clearly not the raw single card we're pricing. */
const NOISE =
  /\b(sticker|magnet|metal|fan\s?art|custom|proxy|key\s?chain|keychain|mini\s?slab|playing\s?card|code\s?card|digital|online|lot|bundle|jumbo|oversized|display|gift|plush|toy|coin|pin|charm|repro|replica|holder|sleeve|binder|case)\b/i;
/** Graded markers — excluded from the RAW price (kept for the PSA 10 lookup). */
const GRADED = /\b(psa|bgs|cgc|sgc|ace|tag|graded|gem\s?mint)\b/i;

const nowSec = () => Math.floor(Date.now() / 1000);
const isSandbox = (env: Env) => (env.EBAY_APP_ID ?? "").includes("-SBX-");
const apiHost = (env: Env) => (isSandbox(env) ? "https://api.sandbox.ebay.com" : "https://api.ebay.com");

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

/** Cached OAuth client-credentials application token. */
async function getToken(env: Env, db: Database): Promise<string | null> {
  const cached = await cacheGet(db, TOKEN_KEY);
  if (cached) return cached;
  if (!env.EBAY_APP_ID || !env.EBAY_CERT_ID) return null;
  try {
    const basic = btoa(`${env.EBAY_APP_ID}:${env.EBAY_CERT_ID}`);
    const res = await fetch(`${apiHost(env)}/identity/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: "grant_type=client_credentials&scope=" + encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
    });
    if (!res.ok) return null;
    const data: { access_token?: string; expires_in?: number } = await res.json();
    if (!data.access_token) return null;
    await cacheSet(db, TOKEN_KEY, data.access_token, Math.max(60, (data.expires_in ?? 7200) - 120));
    return data.access_token;
  } catch {
    return null;
  }
}

interface Summary {
  title?: string;
  price?: { value?: string; currency?: string };
}

/** Lowest USD price (minor units) among listings matching `query` that pass the
 * `accept` predicate on their title. Null when none. */
async function lowestPrice(
  env: Env,
  token: string,
  query: string,
  accept: (title: string) => boolean,
): Promise<number | null> {
  const params = new URLSearchParams({
    q: query,
    category_ids: CCG_CATEGORY,
    filter: "buyingOptions:{FIXED_PRICE}",
    sort: "price",
    limit: "40",
  });
  const url = `${apiHost(env)}/buy/browse/v1/item_summary/search?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
  });
  if (!res.ok) return null;
  const data: { itemSummaries?: Summary[] } = await res.json();
  let min: number | null = null;
  for (const it of data.itemSummaries ?? []) {
    if ((it.price?.currency ?? "USD") !== "USD") continue;
    const value = Number(it.price?.value);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (!accept(it.title ?? "")) continue;
    const minor = Math.round(value * 100);
    if (min === null || minor < min) min = minor;
  }
  return min;
}

/** Build the exact-card search phrase (name + number[/printedTotal] + set). */
function cardQuery(card: EbayCardRef): string {
  const number = card.printedTotal ? `${card.number}/${card.printedTotal}` : card.number;
  return [card.name, card.setName, number].filter(Boolean).join(" ");
}

export interface EbayCardRef {
  id: string;
  name: string;
  setName: string;
  number: string;
  printedTotal: number | null;
}

async function refresh(env: Env, db: Database, card: EbayCardRef): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const used = await incrementCounter(db, `ebay:refresh:${day}`, PRICE_TTL_SEC);
  if (used !== null && used > DAILY_REFRESH_CAP) return; // protect the rate limit
  const token = await getToken(env, db);
  if (!token) return;
  const base = cardQuery(card);
  const [rawFromMinor, psa9FromMinor, psa10FromMinor] = await Promise.all([
    // Raw = single card, not graded, not novelty.
    lowestPrice(env, token, base, (t) => !NOISE.test(t) && !GRADED.test(t)),
    // PSA 9 / PSA 10 = title must actually say that grade, minus novelty items.
    lowestPrice(env, token, `${base} PSA 9`, (t) => /psa\s?9\b/i.test(t) && !NOISE.test(t)),
    lowestPrice(env, token, `${base} PSA 10`, (t) => /psa\s?10\b/i.test(t) && !NOISE.test(t)),
  ]);
  await cacheSet(
    db,
    `ebay:prices:v2:${card.id}`,
    JSON.stringify({ rawFromMinor, psa9FromMinor, psa10FromMinor } satisfies EbayCardPrices),
    PRICE_TTL_SEC,
  );
  // Persist graded prices so they can be valued in portfolios and snapshotted
  // into history (raw stays TCGplayer — not stored here).
  await persistGraded(db, card.id, "psa9", psa9FromMinor);
  await persistGraded(db, card.id, "psa10", psa10FromMinor);
}

/** Upsert (or clear) a graded price for a card. */
async function persistGraded(
  db: Database,
  cardId: string,
  grade: "psa9" | "psa10",
  fromMinor: number | null,
): Promise<void> {
  try {
    if (fromMinor == null) return;
    await db
      .insert(schema.cardGradedPrices)
      .values({ cardId, grade, currency: "USD", fromMinor, observedAt: new Date() })
      .onConflictDoUpdate({
        target: [
          schema.cardGradedPrices.cardId,
          schema.cardGradedPrices.grade,
          schema.cardGradedPrices.currency,
        ],
        set: { fromMinor, observedAt: new Date() },
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
  const cached = await cacheGet(db, `ebay:prices:v2:${card.id}`);
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
