/**
 * Public catalog queries — always D1, never the external API (SPEC §15).
 * Indexed pagination only; no SELECT * on hot paths.
 */

import { and, asc, count, desc, eq, gte, inArray, like, lt, max, sql, type SQL } from "drizzle-orm";

import { cached } from "../cache/catalog-cache.server";
import { schema, type Database } from "../db/index.server";
import { MARKET_CURRENCY, MARKET_SOURCE, type Market } from "../market/market";
import { buildFtsMatch, CARD_SEARCH_BM25_WEIGHTS } from "./search.server";

/** TTL (s) for the visitor-identical aggregate caches (per market). */
const MOVERS_CACHE_TTL = 600;
const POKEDEX_CACHE_TTL = 900;

export const CATALOG_PAGE_SIZE = 24;
export const MAX_PAGE = 400;

const cardListColumns = {
  id: schema.pokemonCards.id,
  slug: schema.pokemonCards.slug,
  name: schema.pokemonCards.name,
  number: schema.pokemonCards.number,
  rarity: schema.pokemonCards.rarity,
  setId: schema.pokemonCards.setId,
  imageSmallUrl: schema.pokemonCards.imageSmallUrl,
};

export interface CardSearchParams {
  q?: string;
  setId?: string;
  rarity?: string;
  type?: string;
  supertype?: string;
  sort?: "name" | "number" | "newest";
  page?: number;
}

export interface CardListItem {
  id: string;
  slug: string;
  name: string;
  number: string;
  rarity: string | null;
  setId: string;
  setName?: string | null;
  series?: string | null;
  releaseDate?: string | null;
  imageSmallUrl: string | null;
  priceMinor?: number | null;
}

/** Sets for the /cards filter dropdown (newest first). */
export async function listSetsBrief(db: Database): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: schema.pokemonSets.id, name: schema.pokemonSets.name })
    .from(schema.pokemonSets)
    .orderBy(desc(schema.pokemonSets.releaseDate));
}

export interface CardBrief {
  id: string;
  slug: string;
  name: string;
  number: string;
  setName: string;
  imageSmallUrl: string | null;
}

/** Lightweight card lookup by slug (compare picker / compare page). Preserves
 * the caller's slug order and silently drops unknown slugs. */
export async function getCardsBriefBySlugs(db: Database, slugs: string[]): Promise<CardBrief[]> {
  if (slugs.length === 0) return [];
  const rows = await db
    .select({
      id: schema.pokemonCards.id,
      slug: schema.pokemonCards.slug,
      name: schema.pokemonCards.name,
      number: schema.pokemonCards.number,
      setName: schema.pokemonSets.name,
      imageSmallUrl: schema.pokemonCards.imageSmallUrl,
    })
    .from(schema.pokemonCards)
    .innerJoin(schema.pokemonSets, eq(schema.pokemonCards.setId, schema.pokemonSets.id))
    .where(and(inArray(schema.pokemonCards.slug, slugs), eq(schema.pokemonCards.active, true)));
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  return slugs.map((s) => bySlug.get(s)).filter((r): r is CardBrief => r !== undefined);
}

export async function searchCards(
  db: Database,
  params: CardSearchParams,
): Promise<{ items: CardListItem[]; total: number; page: number; pageCount: number }> {
  const page = Math.min(Math.max(params.page ?? 1, 1), MAX_PAGE);
  // A text query goes through the FTS5 index (tokenized, ranked); browsing with
  // only structured filters uses the plain indexed table scan.
  const match = params.q ? buildFtsMatch(params.q, "and") : null;
  return match ? searchCardsFts(db, params, page, match) : searchCardsBrowse(db, params, page);
}

const pageCountOf = (total: number) =>
  Math.max(1, Math.min(Math.ceil(total / CATALOG_PAGE_SIZE), MAX_PAGE));

/** Column list for the raw FTS SELECT, aliased to CardListItem keys. */
const FTS_SELECT = sql`
  k.id AS id, k.slug AS slug, k.name AS name, k.number AS number,
  k.rarity AS rarity, k.set_id AS "setId",
  k.image_small_url AS "imageSmallUrl", s.name AS "setName",
  s.series AS series, s.release_date AS "releaseDate"
`;
const bm25Rank = sql.raw(`bm25(card_search, ${CARD_SEARCH_BM25_WEIGHTS.join(", ")})`);

/** Structured (non-text) filters as SQL fragments against the joined card row. */
function ftsFilters(params: CardSearchParams): SQL {
  const filters: SQL[] = [];
  if (params.setId) filters.push(sql`AND k.set_id = ${params.setId}`);
  if (params.rarity) filters.push(sql`AND k.rarity = ${params.rarity}`);
  if (params.supertype) filters.push(sql`AND k.supertype = ${params.supertype}`);
  if (params.type)
    filters.push(sql`AND k.types_json LIKE ${`%"${params.type.replaceAll('"', "")}"%`}`);
  return filters.length ? sql.join(filters, sql` `) : sql``;
}

/** Ranked FTS5 search: all query tokens must match; ordered by relevance (bm25)
 * unless the user picked an explicit sort. */
async function searchCardsFts(
  db: Database,
  params: CardSearchParams,
  page: number,
  match: string,
): Promise<{ items: CardListItem[]; total: number; page: number; pageCount: number }> {
  const filterSql = ftsFilters(params);
  const orderSql =
    params.sort === "number"
      ? sql`k.set_id ASC, k.number_sort ASC, k.number ASC`
      : params.sort === "newest"
        ? sql`k.source_updated_at DESC, k.name ASC`
        : sql`${bm25Rank} ASC, k.number_sort ASC`;
  const offset = (page - 1) * CATALOG_PAGE_SIZE;
  const [items, totalRows] = await Promise.all([
    db.all<CardListItem>(sql`
      SELECT ${FTS_SELECT}
      FROM card_search
      JOIN pokemon_cards k ON k.id = card_search.card_id AND k.active = 1
      JOIN pokemon_sets s ON s.id = k.set_id
      WHERE card_search MATCH ${match} ${filterSql}
      ORDER BY ${orderSql}
      LIMIT ${CATALOG_PAGE_SIZE} OFFSET ${offset}
    `),
    db.all<{ total: number }>(sql`
      SELECT count(*) AS total
      FROM card_search
      JOIN pokemon_cards k ON k.id = card_search.card_id AND k.active = 1
      WHERE card_search MATCH ${match} ${filterSql}
    `),
  ]);
  const total = totalRows[0]?.total ?? 0;
  return { items, total, page, pageCount: pageCountOf(total) };
}

/** Browse (no text query): structured filters + sort over the indexed table. */
async function searchCardsBrowse(
  db: Database,
  params: CardSearchParams,
  page: number,
): Promise<{ items: CardListItem[]; total: number; page: number; pageCount: number }> {
  const conditions: SQL[] = [eq(schema.pokemonCards.active, true)];
  if (params.setId) conditions.push(eq(schema.pokemonCards.setId, params.setId));
  if (params.rarity) conditions.push(eq(schema.pokemonCards.rarity, params.rarity));
  if (params.supertype) conditions.push(eq(schema.pokemonCards.supertype, params.supertype));
  if (params.type)
    conditions.push(like(schema.pokemonCards.typesJson, `%"${params.type.replaceAll('"', "")}"%`));

  const where = and(...conditions);
  const orderBy =
    params.sort === "number"
      ? [
          asc(schema.pokemonCards.setId),
          asc(schema.pokemonCards.numberSort),
          asc(schema.pokemonCards.number),
        ]
      : params.sort === "newest"
        ? [desc(schema.pokemonCards.sourceUpdatedAt), asc(schema.pokemonCards.name)]
        : [asc(schema.pokemonCards.nameNormalized), asc(schema.pokemonCards.numberSort)];

  const [items, [{ total }]] = await Promise.all([
    db
      .select({
        ...cardListColumns,
        setName: schema.pokemonSets.name,
        series: schema.pokemonSets.series,
        releaseDate: schema.pokemonSets.releaseDate,
      })
      .from(schema.pokemonCards)
      .innerJoin(schema.pokemonSets, eq(schema.pokemonCards.setId, schema.pokemonSets.id))
      .where(where)
      .orderBy(...orderBy)
      .limit(CATALOG_PAGE_SIZE)
      .offset((page - 1) * CATALOG_PAGE_SIZE),
    db.select({ total: count() }).from(schema.pokemonCards).where(where),
  ]);

  return { items, total, page, pageCount: pageCountOf(total) };
}

/**
 * Relaxed "did you mean" suggestions: OR of the query's prefix tokens (any token
 * may match), ranked by bm25. Used for the empty state when the strict AND search
 * returns nothing.
 */
export async function searchCardsRelaxed(
  db: Database,
  q: string,
  limit = 12,
): Promise<CardListItem[]> {
  const match = buildFtsMatch(q, "or");
  if (!match) return [];
  return db.all<CardListItem>(sql`
    SELECT ${FTS_SELECT}
    FROM card_search
    JOIN pokemon_cards k ON k.id = card_search.card_id AND k.active = 1
    JOIN pokemon_sets s ON s.id = k.set_id
    WHERE card_search MATCH ${match}
    ORDER BY ${bm25Rank} ASC
    LIMIT ${limit}
  `);
}

export interface CardDetail {
  card: typeof schema.pokemonCards.$inferSelect;
  set: {
    id: string;
    slug: string;
    name: string;
    series: string;
    releaseDate: string | null;
    printedTotal: number | null;
  };
  prices: (typeof schema.cardPricesCurrent.$inferSelect)[];
  related: CardListItem[];
  trackingSince: string | null;
}

export async function getCardBySlug(db: Database, slug: string): Promise<CardDetail | null> {
  const card = await db.query.pokemonCards.findFirst({
    where: eq(schema.pokemonCards.slug, slug),
  });
  if (!card) return null;

  const [set, prices, related, firstHistory] = await Promise.all([
    db
      .select({
        id: schema.pokemonSets.id,
        slug: schema.pokemonSets.slug,
        name: schema.pokemonSets.name,
        series: schema.pokemonSets.series,
        releaseDate: schema.pokemonSets.releaseDate,
        printedTotal: schema.pokemonSets.printedTotal,
      })
      .from(schema.pokemonSets)
      .where(eq(schema.pokemonSets.id, card.setId))
      .then((rows) => rows[0]),
    db.select().from(schema.cardPricesCurrent).where(eq(schema.cardPricesCurrent.cardId, card.id)),
    db
      .select(cardListColumns)
      .from(schema.pokemonCards)
      .where(
        and(
          eq(schema.pokemonCards.setId, card.setId),
          eq(schema.pokemonCards.active, true),
          sql`${schema.pokemonCards.id} != ${card.id}`,
          gte(schema.pokemonCards.numberSort, Math.max(0, card.numberSort - 4)),
        ),
      )
      .orderBy(asc(schema.pokemonCards.numberSort))
      .limit(8),
    db
      .select({ recordedDate: schema.cardPriceHistory.recordedDate })
      .from(schema.cardPriceHistory)
      .where(eq(schema.cardPriceHistory.cardId, card.id))
      .orderBy(asc(schema.cardPriceHistory.recordedDate))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  if (!set) return null;
  return { card, set, prices, related, trackingSince: firstHistory?.recordedDate ?? null };
}

export async function getCardPriceHistory(
  db: Database,
  cardId: string,
  options: { variant?: string; source?: string; sinceDate?: string },
): Promise<
  { recordedDate: string; priceMinor: number; variant: string; source: string; currency: string }[]
> {
  const conditions: SQL[] = [eq(schema.cardPriceHistory.cardId, cardId)];
  if (options.variant) {
    conditions.push(
      eq(schema.cardPriceHistory.variant, options.variant as (typeof schema.CARD_VARIANTS)[number]),
    );
  }
  if (options.source) {
    conditions.push(
      eq(schema.cardPriceHistory.source, options.source as (typeof schema.PRICE_SOURCES)[number]),
    );
  }
  if (options.sinceDate)
    conditions.push(gte(schema.cardPriceHistory.recordedDate, options.sinceDate));

  return db
    .select({
      recordedDate: schema.cardPriceHistory.recordedDate,
      priceMinor: schema.cardPriceHistory.priceMinor,
      variant: schema.cardPriceHistory.variant,
      source: schema.cardPriceHistory.source,
      currency: schema.cardPriceHistory.currency,
    })
    .from(schema.cardPriceHistory)
    .where(and(...conditions))
    .orderBy(asc(schema.cardPriceHistory.recordedDate))
    .limit(800);
}

/** Graded (PSA) price history for a card + grade (eBay-sourced, USD). */
export async function getGradedPriceHistory(
  db: Database,
  cardId: string,
  grade: (typeof schema.GRADES)[number],
): Promise<{ recordedDate: string; priceMinor: number }[]> {
  return db
    .select({
      recordedDate: schema.cardGradedPriceHistory.recordedDate,
      priceMinor: schema.cardGradedPriceHistory.priceMinor,
    })
    .from(schema.cardGradedPriceHistory)
    .where(
      and(
        eq(schema.cardGradedPriceHistory.cardId, cardId),
        eq(schema.cardGradedPriceHistory.grade, grade),
        eq(schema.cardGradedPriceHistory.currency, "USD"),
      ),
    )
    .orderBy(asc(schema.cardGradedPriceHistory.recordedDate))
    .limit(800);
}

// ── Sets ─────────────────────────────────────────────────────────────────────

export interface SetListParams {
  series?: string;
  sort?: "release" | "name" | "cards";
  page?: number;
}

export async function listSets(db: Database, params: SetListParams) {
  const page = Math.min(Math.max(params.page ?? 1, 1), MAX_PAGE);
  const PAGE_SIZE = 30;
  const conditions: SQL[] = [eq(schema.pokemonSets.active, true)];
  if (params.series) conditions.push(eq(schema.pokemonSets.series, params.series));
  const where = and(...conditions);

  const orderBy =
    params.sort === "name"
      ? [asc(schema.pokemonSets.nameNormalized)]
      : params.sort === "cards"
        ? [desc(schema.pokemonSets.total)]
        : [desc(schema.pokemonSets.releaseDate)];

  const [items, [{ total }], seriesRows] = await Promise.all([
    db
      .select({
        id: schema.pokemonSets.id,
        slug: schema.pokemonSets.slug,
        name: schema.pokemonSets.name,
        series: schema.pokemonSets.series,
        releaseDate: schema.pokemonSets.releaseDate,
        printedTotal: schema.pokemonSets.printedTotal,
        total: schema.pokemonSets.total,
        symbolUrl: schema.pokemonSets.symbolUrl,
        logoUrl: schema.pokemonSets.logoUrl,
      })
      .from(schema.pokemonSets)
      .where(where)
      .orderBy(...orderBy)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(schema.pokemonSets).where(where),
    db
      .selectDistinct({ series: schema.pokemonSets.series })
      .from(schema.pokemonSets)
      .orderBy(asc(schema.pokemonSets.series)),
  ]);

  return {
    items,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    seriesOptions: seriesRows.map((r) => r.series),
  };
}

export async function getSetBySlug(db: Database, slug: string, market: Market = "us") {
  const set = await db.query.pokemonSets.findFirst({ where: eq(schema.pokemonSets.slug, slug) });
  if (!set) return null;

  const cards = await db
    .select({
      ...cardListColumns,
      supertype: schema.pokemonCards.supertype,
      priceMinor: sql<number | null>`(
        SELECT p.normalized_price_minor FROM card_prices_current p
        WHERE p.card_id = ${schema.pokemonCards.id}
          AND p.source = ${MARKET_SOURCE[market]} AND p.currency = ${MARKET_CURRENCY[market]}
        ORDER BY p.normalized_price_minor DESC LIMIT 1
      )`,
    })
    .from(schema.pokemonCards)
    .where(and(eq(schema.pokemonCards.setId, set.id), eq(schema.pokemonCards.active, true)))
    .orderBy(asc(schema.pokemonCards.numberSort), asc(schema.pokemonCards.number))
    .limit(600);

  const pricedValues = cards.filter((c) => c.priceMinor !== null);
  const estimatedValueMinor =
    pricedValues.length >= Math.max(3, cards.length * 0.3)
      ? pricedValues.reduce((sum, c) => sum + (c.priceMinor ?? 0), 0)
      : null;

  return { set, cards, estimatedValueMinor, pricedCount: pricedValues.length };
}

// ── Most valuable cards (value pillar + per-set module) ──────────────────────

/** TTL (s) for the most-valuable aggregate (per market, per scope). */
const TOP_VALUE_CACHE_TTL = 900;
/** Upper sanity guard: drop rows above $1,000,000 (100M minor) — never a real
 * live-market TCGplayer/Cardmarket figure, so almost always corrupt data. */
const TOP_VALUE_MAX_MINOR = 100_000_000;

/**
 * Highest-value cards by CURRENT market price — powers the /most-valuable-pokemon-cards
 * pillar (global) and the "Most valuable cards in {Set}" module (setId-scoped).
 * The headline price is the MAX representative price across a card's variants in
 * the active market (mirrors the per-card price on the set page). Cards with no
 * price in the market are excluded (inner join). Visitor-identical → TTL-cached
 * per (market, setId, limit).
 */
export async function listTopValueCards(
  db: Database,
  opts: { market?: Market; setId?: string; limit?: number } = {},
): Promise<CardListItem[]> {
  const market = opts.market ?? "us";
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 250);
  const scope = opts.setId ?? "all";
  const key = `topvalue:${market}:${scope}:${limit}`;

  return cached(db, key, TOP_VALUE_CACHE_TTL, async () => {
    const priceMinor = max(schema.cardPricesCurrent.normalizedPriceMinor);
    const rows = await db
      .select({
        id: schema.pokemonCards.id,
        slug: schema.pokemonCards.slug,
        name: schema.pokemonCards.name,
        number: schema.pokemonCards.number,
        rarity: schema.pokemonCards.rarity,
        setId: schema.pokemonCards.setId,
        imageSmallUrl: schema.pokemonCards.imageSmallUrl,
        setName: schema.pokemonSets.name,
        series: schema.pokemonSets.series,
        priceMinor,
      })
      .from(schema.cardPricesCurrent)
      .innerJoin(
        schema.pokemonCards,
        and(
          eq(schema.pokemonCards.id, schema.cardPricesCurrent.cardId),
          eq(schema.pokemonCards.active, true),
        ),
      )
      .innerJoin(schema.pokemonSets, eq(schema.pokemonSets.id, schema.pokemonCards.setId))
      .where(
        and(
          eq(schema.cardPricesCurrent.source, MARKET_SOURCE[market]),
          eq(schema.cardPricesCurrent.currency, MARKET_CURRENCY[market]),
          gte(schema.cardPricesCurrent.normalizedPriceMinor, 1),
          lt(schema.cardPricesCurrent.normalizedPriceMinor, TOP_VALUE_MAX_MINOR),
          opts.setId ? eq(schema.pokemonCards.setId, opts.setId) : undefined,
        ),
      )
      .groupBy(schema.pokemonCards.id)
      .orderBy(desc(priceMinor))
      .limit(limit);
    return rows;
  });
}

// ── Homepage ─────────────────────────────────────────────────────────────────

export async function getHomepageData(db: Database) {
  const [popularSets, recentCards] = await Promise.all([
    db
      .select({
        id: schema.pokemonSets.id,
        slug: schema.pokemonSets.slug,
        name: schema.pokemonSets.name,
        series: schema.pokemonSets.series,
        releaseDate: schema.pokemonSets.releaseDate,
        logoUrl: schema.pokemonSets.logoUrl,
        symbolUrl: schema.pokemonSets.symbolUrl,
        total: schema.pokemonSets.total,
      })
      .from(schema.pokemonSets)
      .where(eq(schema.pokemonSets.active, true))
      .orderBy(desc(schema.pokemonSets.releaseDate))
      .limit(6),
    db
      .select({ ...cardListColumns, setName: schema.pokemonSets.name })
      .from(schema.pokemonCards)
      .innerJoin(schema.pokemonSets, eq(schema.pokemonCards.setId, schema.pokemonSets.id))
      .where(eq(schema.pokemonCards.active, true))
      .orderBy(desc(schema.pokemonCards.sourceUpdatedAt), desc(schema.pokemonCards.syncedAt))
      .limit(8),
  ]);
  return { popularSets, recentCards };
}

// ── Price movers ─────────────────────────────────────────────────────────────

export interface PriceMover {
  cardId: string;
  slug: string;
  name: string;
  setName: string;
  imageSmallUrl: string | null;
  variant: string;
  currentMinor: number;
  previousMinor: number;
  changeMinor: number;
  changePercent: number;
}

/**
 * Movers require REAL history over the WHOLE catalog (not just collected cards):
 * a card with an observation at/before the window start and a current price.
 * No history → empty result (never fabricated).
 */
export async function getPriceMovers(
  db: Database,
  windowDays: 7 | 30,
  direction: "up" | "down",
  limit = 10,
  market: Market = "us",
): Promise<PriceMover[]> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const rows = await db.all<{
    card_id: string;
    slug: string;
    name: string;
    set_name: string;
    image_small_url: string | null;
    variant: string;
    current_minor: number;
    previous_minor: number;
  }>(sql`
    SELECT c.card_id, k.slug, k.name, s.name AS set_name, k.image_small_url,
           c.variant, c.normalized_price_minor AS current_minor, prev.price_minor AS previous_minor
    FROM card_prices_current c
    JOIN pokemon_cards k ON k.id = c.card_id AND k.active = 1
    JOIN pokemon_sets s ON s.id = k.set_id
    JOIN (
      SELECT h.card_id, h.source, h.variant, h.currency, h.price_minor,
             ROW_NUMBER() OVER (
               PARTITION BY h.card_id, h.source, h.variant, h.currency
               ORDER BY h.recorded_date DESC
             ) AS rn
      FROM card_price_history h
      WHERE h.recorded_date <= ${since}
    ) prev ON prev.card_id = c.card_id AND prev.source = c.source
          AND prev.variant = c.variant AND prev.currency = c.currency AND prev.rn = 1
    WHERE c.source = ${MARKET_SOURCE[market]} AND c.currency = ${MARKET_CURRENCY[market]}
      AND prev.price_minor >= 100
      AND c.normalized_price_minor != prev.price_minor
    ORDER BY (CAST(c.normalized_price_minor - prev.price_minor AS REAL) / prev.price_minor)
      ${direction === "up" ? sql`DESC` : sql`ASC`}
    LIMIT ${limit}
  `);

  return rows
    .filter((r) =>
      direction === "up" ? r.current_minor > r.previous_minor : r.current_minor < r.previous_minor,
    )
    .map((r) => ({
      cardId: r.card_id,
      slug: r.slug,
      name: r.name,
      setName: r.set_name,
      imageSmallUrl: r.image_small_url,
      variant: r.variant,
      currentMinor: r.current_minor,
      previousMinor: r.previous_minor,
      changeMinor: r.current_minor - r.previous_minor,
      changePercent: ((r.current_minor - r.previous_minor) / r.previous_minor) * 100,
    }));
}

/**
 * Both movers directions in ONE pass. The expensive part — the ROW_NUMBER window
 * over the whole `card_price_history` — is computed once in the `moved` CTE, then
 * the two tails (biggest gains / biggest drops) are taken over the materialized
 * set. Semantically identical to two `getPriceMovers` calls (same filters, same
 * `prev.price_minor >= 100` floor, same sign guard) but halves the heavy work.
 * TTL-cached per (window, market, limit) — the result is identical for every
 * visitor in a market and only changes on the daily sync.
 */
export async function getPriceMoversBoth(
  db: Database,
  windowDays: 7 | 30,
  limit = 10,
  market: Market = "us",
): Promise<{ up: PriceMover[]; down: PriceMover[] }> {
  return cached(db, `movers:${windowDays}:${market}:${limit}`, MOVERS_CACHE_TTL, async () => {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const rows = await db.all<{
      card_id: string;
      slug: string;
      name: string;
      set_name: string;
      image_small_url: string | null;
      variant: string;
      current_minor: number;
      previous_minor: number;
      dir: "up" | "down";
    }>(sql`
      WITH moved AS (
        SELECT c.card_id, k.slug, k.name, s.name AS set_name, k.image_small_url,
               c.variant, c.normalized_price_minor AS current_minor, prev.price_minor AS previous_minor,
               (CAST(c.normalized_price_minor - prev.price_minor AS REAL) / prev.price_minor) AS pct
        FROM card_prices_current c
        JOIN pokemon_cards k ON k.id = c.card_id AND k.active = 1
        JOIN pokemon_sets s ON s.id = k.set_id
        JOIN (
          SELECT h.card_id, h.source, h.variant, h.currency, h.price_minor,
                 ROW_NUMBER() OVER (
                   PARTITION BY h.card_id, h.source, h.variant, h.currency
                   ORDER BY h.recorded_date DESC
                 ) AS rn
          FROM card_price_history h
          WHERE h.recorded_date <= ${since}
        ) prev ON prev.card_id = c.card_id AND prev.source = c.source
              AND prev.variant = c.variant AND prev.currency = c.currency AND prev.rn = 1
        WHERE c.source = ${MARKET_SOURCE[market]} AND c.currency = ${MARKET_CURRENCY[market]}
          AND prev.price_minor >= 100
          AND c.normalized_price_minor != prev.price_minor
      )
      SELECT *, 'up' AS dir FROM (SELECT * FROM moved ORDER BY pct DESC LIMIT ${limit})
      UNION ALL
      SELECT *, 'down' AS dir FROM (SELECT * FROM moved ORDER BY pct ASC LIMIT ${limit})
    `);

    const map = (r: (typeof rows)[number]): PriceMover => ({
      cardId: r.card_id,
      slug: r.slug,
      name: r.name,
      setName: r.set_name,
      imageSmallUrl: r.image_small_url,
      variant: r.variant,
      currentMinor: r.current_minor,
      previousMinor: r.previous_minor,
      changeMinor: r.current_minor - r.previous_minor,
      changePercent: ((r.current_minor - r.previous_minor) / r.previous_minor) * 100,
    });

    return {
      up: rows.filter((r) => r.dir === "up" && r.current_minor > r.previous_minor).map(map),
      down: rows.filter((r) => r.dir === "down" && r.current_minor < r.previous_minor).map(map),
    };
  });
}

/** Popularity signal for tracked-card selection (fire-and-forget from card pages). */
export async function bumpCardPopularity(db: Database, cardId: string): Promise<void> {
  await db
    .insert(schema.trackedCards)
    .values({ cardId, popularityScore: 1, lastViewedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.trackedCards.cardId,
      set: {
        popularityScore: sql`${schema.trackedCards.popularityScore} + 1`,
        lastViewedAt: new Date(),
      },
    });
}

export { lt };

// ── Pokédex aggregates ───────────────────────────────────────────────────────

export interface PokedexAggregate {
  cardCount: number;
  avgPriceMinor: number | null;
}

/**
 * Card count + average TCGplayer/USD market price per national Pokédex number.
 * Expands each card's `national_pokedex_numbers_json` array with `json_each`
 * (multi-Pokémon cards count toward each number). One representative price per
 * card (MAX across variants) so multi-variant cards don't skew the average;
 * AVG ignores unpriced cards, COUNT includes them.
 */
export async function listPokedexAggregates(
  db: Database,
  market: Market = "us",
): Promise<Map<number, PokedexAggregate>> {
  // Visitor-identical per market and heavy (full pokemon_cards scan + per-card
  // price subquery) → TTL-cached. Cache a plain array (Maps don't JSON-serialize)
  // and rebuild the Map on the way out.
  const entries = await cached<{ dex: number; cardCount: number; avgPriceMinor: number | null }[]>(
    db,
    `pokedex:${market}`,
    POKEDEX_CACHE_TTL,
    async () => {
      const rows = await db.all<{ dex: number; card_count: number; avg_minor: number | null }>(sql`
        SELECT je.value AS dex,
               COUNT(*) AS card_count,
               AVG(kc.price_minor) AS avg_minor
        FROM (
          SELECT k.id,
                 k.national_pokedex_numbers_json AS dexes,
                 (SELECT MAX(p.normalized_price_minor) FROM card_prices_current p
                  WHERE p.card_id = k.id AND p.source = ${MARKET_SOURCE[market]}
                    AND p.currency = ${MARKET_CURRENCY[market]}) AS price_minor
          FROM pokemon_cards k
          WHERE k.active = 1 AND k.national_pokedex_numbers_json IS NOT NULL
        ) kc
        JOIN json_each(kc.dexes) je
        GROUP BY je.value
      `);
      return rows.map((r) => ({
        dex: Number(r.dex),
        cardCount: Number(r.card_count),
        avgPriceMinor: r.avg_minor == null ? null : Math.round(Number(r.avg_minor)),
      }));
    },
  );
  const map = new Map<number, PokedexAggregate>();
  for (const e of entries) {
    map.set(e.dex, { cardCount: e.cardCount, avgPriceMinor: e.avgPriceMinor });
  }
  return map;
}

/**
 * Every card of one Pokémon (by national Pokédex number), across all sets, with
 * its current market price (MAX across variants). Powers the per-Pokémon hub
 * (/pokemon/{name}). Ordered most-valuable first (unpriced last). Visitor-
 * identical per (dex, market) → TTL-cached.
 */
export async function listCardsByPokedex(
  db: Database,
  dex: number,
  market: Market = "us",
  limit = 300,
): Promise<CardListItem[]> {
  if (!Number.isInteger(dex) || dex < 1) return [];
  return cached(db, `pokemoncards:${market}:${dex}:${limit}`, TOP_VALUE_CACHE_TTL, async () => {
    const rows = await db.all<{
      id: string;
      slug: string;
      name: string;
      number: string;
      rarity: string | null;
      set_id: string;
      set_name: string;
      release_date: string | null;
      image_small_url: string | null;
      price_minor: number | null;
    }>(sql`
      SELECT k.id, k.slug, k.name, k.number, k.rarity,
             k.set_id, s.name AS set_name, s.release_date, k.image_small_url,
             (SELECT MAX(p.normalized_price_minor) FROM card_prices_current p
              WHERE p.card_id = k.id AND p.source = ${MARKET_SOURCE[market]}
                AND p.currency = ${MARKET_CURRENCY[market]}) AS price_minor
      FROM pokemon_cards k
      JOIN pokemon_sets s ON s.id = k.set_id
      WHERE k.active = 1 AND k.national_pokedex_numbers_json IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM json_each(k.national_pokedex_numbers_json) je WHERE je.value = ${dex}
        )
      ORDER BY price_minor DESC, s.release_date DESC, k.number
      LIMIT ${limit}
    `);
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      number: r.number,
      rarity: r.rarity,
      setId: r.set_id,
      setName: r.set_name,
      releaseDate: r.release_date,
      imageSmallUrl: r.image_small_url,
      priceMinor: r.price_minor == null ? null : Number(r.price_minor),
    }));
  });
}

/** Per-user Pokédex overlay: distinct owned cards per dex + favourited dex numbers.
 * Never cached at the edge (personal) — fetched client-side by the Pokédex page. */
export async function getUserPokedexOverlay(
  db: Database,
  userId: string,
): Promise<{ owned: Record<number, number>; favorites: number[] }> {
  const ownedRows = await db.all<{ dex: number; owned: number }>(sql`
    SELECT je.value AS dex, COUNT(DISTINCT e.card_id) AS owned
    FROM collection_entries e
    JOIN pokemon_cards k ON k.id = e.card_id
    JOIN json_each(k.national_pokedex_numbers_json) je
    WHERE e.user_id = ${userId} AND k.national_pokedex_numbers_json IS NOT NULL
    GROUP BY je.value
  `);
  const owned: Record<number, number> = {};
  for (const r of ownedRows) owned[Number(r.dex)] = Number(r.owned);

  const favRows = await db
    .select({ dex: schema.pokedexFavorites.dex })
    .from(schema.pokedexFavorites)
    .where(eq(schema.pokedexFavorites.userId, userId));
  return { owned, favorites: favRows.map((r) => Number(r.dex)) };
}

/** Toggle a favourite; returns the new state (true = now favourited). */
export async function togglePokedexFavorite(
  db: Database,
  userId: string,
  dex: number,
): Promise<boolean> {
  const existing = await db.query.pokedexFavorites.findFirst({
    where: (t, { and: a, eq: e }) => a(e(t.userId, userId), e(t.dex, dex)),
  });
  if (existing) {
    await db
      .delete(schema.pokedexFavorites)
      .where(and(eq(schema.pokedexFavorites.userId, userId), eq(schema.pokedexFavorites.dex, dex)));
    return false;
  }
  await db.insert(schema.pokedexFavorites).values({ userId, dex }).onConflictDoNothing();
  return true;
}
