/**
 * Public catalog queries — always D1, never the external API (SPEC §15).
 * Indexed pagination only; no SELECT * on hot paths.
 */

import { and, asc, count, desc, eq, gte, like, lt, or, sql, type SQL } from "drizzle-orm";

import { schema, type Database } from "../db/index.server";
import { normalizeName } from "../seo/slug";

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
  imageSmallUrl: string | null;
  priceMinor?: number | null;
}

export async function searchCards(
  db: Database,
  params: CardSearchParams,
): Promise<{ items: CardListItem[]; total: number; page: number; pageCount: number }> {
  const page = Math.min(Math.max(params.page ?? 1, 1), MAX_PAGE);
  const conditions: SQL[] = [eq(schema.pokemonCards.active, true)];

  if (params.q) {
    const needle = normalizeName(params.q).slice(0, 80);
    if (needle) {
      // Prefix match uses the name index; substring falls back to search_text.
      conditions.push(
        or(
          like(schema.pokemonCards.nameNormalized, `${needle}%`),
          like(schema.pokemonCards.searchText, `%${needle}%`),
        ) as SQL,
      );
    }
  }
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
      .select({ ...cardListColumns, setName: schema.pokemonSets.name })
      .from(schema.pokemonCards)
      .innerJoin(schema.pokemonSets, eq(schema.pokemonCards.setId, schema.pokemonSets.id))
      .where(where)
      .orderBy(...orderBy)
      .limit(CATALOG_PAGE_SIZE)
      .offset((page - 1) * CATALOG_PAGE_SIZE),
    db.select({ total: count() }).from(schema.pokemonCards).where(where),
  ]);

  return {
    items,
    total,
    page,
    pageCount: Math.max(1, Math.min(Math.ceil(total / CATALOG_PAGE_SIZE), MAX_PAGE)),
  };
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

export async function getSetBySlug(db: Database, slug: string) {
  const set = await db.query.pokemonSets.findFirst({ where: eq(schema.pokemonSets.slug, slug) });
  if (!set) return null;

  const cards = await db
    .select({
      ...cardListColumns,
      supertype: schema.pokemonCards.supertype,
      priceMinor: sql<number | null>`(
        SELECT p.normalized_price_minor FROM card_prices_current p
        WHERE p.card_id = ${schema.pokemonCards.id}
          AND p.source = 'tcgplayer'
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
 * Movers require REAL history: a tracked card with an observation at/before the
 * window start and a current price. No history → empty result (never fabricated).
 */
export async function getPriceMovers(
  db: Database,
  windowDays: 7 | 30,
  direction: "up" | "down",
  limit = 10,
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
    WHERE c.source = 'tcgplayer' AND c.currency = 'USD'
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
export async function listPokedexAggregates(db: Database): Promise<Map<number, PokedexAggregate>> {
  const rows = await db.all<{ dex: number; card_count: number; avg_minor: number | null }>(sql`
    SELECT je.value AS dex,
           COUNT(*) AS card_count,
           AVG(kc.price_minor) AS avg_minor
    FROM (
      SELECT k.id,
             k.national_pokedex_numbers_json AS dexes,
             (SELECT MAX(p.normalized_price_minor) FROM card_prices_current p
              WHERE p.card_id = k.id AND p.source = 'tcgplayer' AND p.currency = 'USD') AS price_minor
      FROM pokemon_cards k
      WHERE k.active = 1 AND k.national_pokedex_numbers_json IS NOT NULL
    ) kc
    JOIN json_each(kc.dexes) je
    GROUP BY je.value
  `);
  const map = new Map<number, PokedexAggregate>();
  for (const r of rows) {
    map.set(Number(r.dex), {
      cardCount: Number(r.card_count),
      avgPriceMinor: r.avg_minor == null ? null : Math.round(Number(r.avg_minor)),
    });
  }
  return map;
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
