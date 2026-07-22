/**
 * Riftbound public catalog queries (read-only MVP). Prices are USD from JustTCG
 * (TCGplayer aggregate); the US/EU market switch doesn't meaningfully apply yet,
 * so the headline price is the max USD across variants (mirrors getSetBySlug).
 */
import { and, asc, count, desc, eq, like, sql } from "drizzle-orm";

import { schema, type Database } from "../db/index.server";

export const RIFTBOUND_PAGE_SIZE = 24;

/** Max USD price across a card's variants — the representative "from" value. */
const priceExpr = sql<number | null>`(
  SELECT MAX(p.normalized_price_minor) FROM riftbound_prices_current p
  WHERE p.card_id = ${schema.riftboundCards.id} AND p.currency = 'USD'
)`;

export interface RiftboundCardListItem {
  id: string;
  slug: string;
  name: string;
  number: string;
  rarity: string | null;
  imageSmallUrl: string | null;
  setName: string;
  priceMinor: number | null;
}

export async function listRiftboundCards(
  db: Database,
  opts: { q?: string; setId?: string; page?: number },
) {
  const page = Math.max(1, opts.page ?? 1);
  const conditions = [eq(schema.riftboundCards.active, true)];
  if (opts.setId) conditions.push(eq(schema.riftboundCards.setId, opts.setId));
  if (opts.q) {
    const needle = opts.q.toLowerCase().slice(0, 80);
    conditions.push(like(schema.riftboundCards.searchText, `%${needle}%`));
  }
  const where = and(...conditions);

  const [items, [{ total }]] = await Promise.all([
    db
      .select({
        id: schema.riftboundCards.id,
        slug: schema.riftboundCards.slug,
        name: schema.riftboundCards.name,
        number: schema.riftboundCards.number,
        rarity: schema.riftboundCards.rarity,
        imageSmallUrl: schema.riftboundCards.imageSmallUrl,
        setName: schema.riftboundSets.name,
        priceMinor: priceExpr,
      })
      .from(schema.riftboundCards)
      .innerJoin(schema.riftboundSets, eq(schema.riftboundCards.setId, schema.riftboundSets.id))
      .where(where)
      .orderBy(asc(schema.riftboundCards.nameNormalized))
      .limit(RIFTBOUND_PAGE_SIZE)
      .offset((page - 1) * RIFTBOUND_PAGE_SIZE),
    db.select({ total: count() }).from(schema.riftboundCards).where(where),
  ]);

  return {
    items,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / RIFTBOUND_PAGE_SIZE)),
  };
}

export async function getRiftboundCardBySlug(db: Database, slug: string) {
  const card = await db.query.riftboundCards.findFirst({
    where: eq(schema.riftboundCards.slug, slug),
  });
  if (!card || !card.active) return null;

  const [set, prices, related] = await Promise.all([
    db.query.riftboundSets.findFirst({ where: eq(schema.riftboundSets.id, card.setId) }),
    db
      .select()
      .from(schema.riftboundPricesCurrent)
      .where(eq(schema.riftboundPricesCurrent.cardId, card.id)),
    db
      .select({
        id: schema.riftboundCards.id,
        slug: schema.riftboundCards.slug,
        name: schema.riftboundCards.name,
        number: schema.riftboundCards.number,
        imageSmallUrl: schema.riftboundCards.imageSmallUrl,
      })
      .from(schema.riftboundCards)
      .where(
        and(
          eq(schema.riftboundCards.setId, card.setId),
          eq(schema.riftboundCards.active, true),
          sql`${schema.riftboundCards.id} != ${card.id}`,
        ),
      )
      .orderBy(asc(schema.riftboundCards.numberSort))
      .limit(8),
  ]);
  if (!set) return null;
  return { card, set, prices, related };
}

export async function getRiftboundPriceHistory(db: Database, cardId: string) {
  return db
    .select({
      recordedDate: schema.riftboundPriceHistory.recordedDate,
      priceMinor: schema.riftboundPriceHistory.priceMinor,
    })
    .from(schema.riftboundPriceHistory)
    .where(
      and(
        eq(schema.riftboundPriceHistory.cardId, cardId),
        eq(schema.riftboundPriceHistory.currency, "USD"),
      ),
    )
    .orderBy(asc(schema.riftboundPriceHistory.recordedDate))
    .limit(800);
}

export async function listRiftboundSets(db: Database) {
  return db
    .select({
      id: schema.riftboundSets.id,
      slug: schema.riftboundSets.slug,
      name: schema.riftboundSets.name,
      releaseDate: schema.riftboundSets.releaseDate,
      imageUrl: schema.riftboundSets.imageUrl,
      cardCount: sql<number>`(
        SELECT COUNT(*) FROM riftbound_cards k WHERE k.set_id = ${schema.riftboundSets.id} AND k.active = 1
      )`,
    })
    .from(schema.riftboundSets)
    .where(eq(schema.riftboundSets.active, true))
    .orderBy(desc(schema.riftboundSets.releaseDate))
    .limit(200);
}

export async function getRiftboundSetBySlug(db: Database, slug: string) {
  const set = await db.query.riftboundSets.findFirst({
    where: eq(schema.riftboundSets.slug, slug),
  });
  if (!set) return null;
  const cards = await db
    .select({
      id: schema.riftboundCards.id,
      slug: schema.riftboundCards.slug,
      name: schema.riftboundCards.name,
      number: schema.riftboundCards.number,
      rarity: schema.riftboundCards.rarity,
      imageSmallUrl: schema.riftboundCards.imageSmallUrl,
      setName: schema.riftboundSets.name,
      priceMinor: priceExpr,
    })
    .from(schema.riftboundCards)
    .innerJoin(schema.riftboundSets, eq(schema.riftboundCards.setId, schema.riftboundSets.id))
    .where(and(eq(schema.riftboundCards.setId, set.id), eq(schema.riftboundCards.active, true)))
    .orderBy(asc(schema.riftboundCards.numberSort), asc(schema.riftboundCards.number))
    .limit(600);
  return { set, cards };
}
