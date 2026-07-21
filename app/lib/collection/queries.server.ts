/**
 * Collection repository. EVERY query filters by the authenticated user ID —
 * ownership is enforced here, not in routes (SPEC §7/§22 BOLA defense).
 */

import { and, asc, count, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";

import { LIMITS, limitResponse, limitsFor } from "../limits";
import { getUserPlan } from "../billing/entitlement.server";
import { schema, type Database } from "../db/index.server";
import { MARKET_CURRENCY, MARKET_SOURCE, type Market } from "../market/market";
import { invalidateProgressForCard } from "../sets/progress.server";
import { bumpTrackedCounts } from "./tracked.server";

export const COLLECTION_PAGE_SIZE = 25;

export interface CollectionFilters {
  q?: string;
  setId?: string;
  variant?: string;
  grade?: string;
  condition?: string;
  unpricedOnly?: boolean;
  sort?: "updated" | "name" | "value" | "quantity";
  page?: number;
}

export async function listCollection(
  db: Database,
  userId: string,
  filters: CollectionFilters,
  market: Market,
) {
  const page = Math.max(1, filters.page ?? 1);
  const conditions: SQL[] = [eq(schema.collectionEntries.userId, userId)];
  if (filters.setId) conditions.push(eq(schema.pokemonCards.setId, filters.setId));
  if (filters.variant)
    conditions.push(
      eq(
        schema.collectionEntries.variant,
        filters.variant as (typeof schema.CARD_VARIANTS)[number],
      ),
    );
  if (filters.grade)
    conditions.push(
      eq(schema.collectionEntries.grade, filters.grade as (typeof schema.GRADES)[number]),
    );
  if (filters.condition)
    conditions.push(
      eq(
        schema.collectionEntries.condition,
        filters.condition as (typeof schema.CONDITIONS)[number],
      ),
    );
  if (filters.q) {
    const needle = filters.q.toLowerCase().slice(0, 80);
    conditions.push(sql`${schema.pokemonCards.searchText} LIKE ${"%" + needle + "%"}`);
  }

  // Grade-aware, market-aware price. Raw → the active market's source/currency
  // (US=TCGplayer/USD, EU=Cardmarket/EUR). PSA-graded → eBay graded price, which
  // exists only in USD; in a non-US market graded cards have no comparable value
  // so they read as unpriced (NULL) rather than mixing currencies.
  const gradedBranch =
    market === "us"
      ? sql`(
      SELECT g.from_minor FROM card_graded_prices g
      WHERE g.card_id = ${schema.collectionEntries.cardId}
        AND g.grade = ${schema.collectionEntries.grade} AND g.currency = 'USD'
    )`
      : sql`NULL`;
  const priceExpr = sql<number | null>`(
    CASE WHEN ${schema.collectionEntries.grade} = 'raw' THEN (
      SELECT p.normalized_price_minor FROM card_prices_current p
      WHERE p.card_id = ${schema.collectionEntries.cardId}
        AND p.variant = ${schema.collectionEntries.variant}
        AND p.source = ${MARKET_SOURCE[market]} AND p.currency = ${MARKET_CURRENCY[market]}
    ) ELSE ${gradedBranch} END
  )`;
  if (filters.unpricedOnly) conditions.push(sql`${priceExpr} IS NULL`);

  const where = and(...conditions);
  const orderBy =
    filters.sort === "name"
      ? [asc(schema.pokemonCards.nameNormalized)]
      : filters.sort === "value"
        ? [sql`${priceExpr} * ${schema.collectionEntries.quantity} DESC NULLS LAST`]
        : filters.sort === "quantity"
          ? [desc(schema.collectionEntries.quantity)]
          : [desc(schema.collectionEntries.updatedAt)];

  const [items, [{ total }]] = await Promise.all([
    db
      .select({
        id: schema.collectionEntries.id,
        cardId: schema.collectionEntries.cardId,
        quantity: schema.collectionEntries.quantity,
        variant: schema.collectionEntries.variant,
        grade: schema.collectionEntries.grade,
        condition: schema.collectionEntries.condition,
        language: schema.collectionEntries.language,
        purchasePriceMinor: schema.collectionEntries.purchasePriceMinor,
        purchaseCurrency: schema.collectionEntries.purchaseCurrency,
        purchaseDate: schema.collectionEntries.purchaseDate,
        notes: schema.collectionEntries.notes,
        updatedAt: schema.collectionEntries.updatedAt,
        cardName: schema.pokemonCards.name,
        cardSlug: schema.pokemonCards.slug,
        cardNumber: schema.pokemonCards.number,
        setId: schema.pokemonCards.setId,
        setName: schema.pokemonSets.name,
        imageSmallUrl: schema.pokemonCards.imageSmallUrl,
        currentPriceMinor: priceExpr,
      })
      .from(schema.collectionEntries)
      .innerJoin(schema.pokemonCards, eq(schema.collectionEntries.cardId, schema.pokemonCards.id))
      .innerJoin(schema.pokemonSets, eq(schema.pokemonCards.setId, schema.pokemonSets.id))
      .where(where)
      .orderBy(...orderBy)
      .limit(COLLECTION_PAGE_SIZE)
      .offset((page - 1) * COLLECTION_PAGE_SIZE),
    db
      .select({ total: count() })
      .from(schema.collectionEntries)
      .innerJoin(schema.pokemonCards, eq(schema.collectionEntries.cardId, schema.pokemonCards.id))
      .where(where),
  ]);

  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / COLLECTION_PAGE_SIZE)) };
}

export interface EntryInput {
  cardId: string;
  quantity: number;
  variant: (typeof schema.CARD_VARIANTS)[number];
  grade?: (typeof schema.GRADES)[number];
  condition: (typeof schema.CONDITIONS)[number];
  language: string;
  purchasePriceMinor: number | null;
  purchaseDate: string | null;
  notes: string | null;
}

export async function addEntry(
  db: Database,
  userId: string,
  input: EntryInput,
  market: Market,
) {
  const [{ n }] = await db
    .select({ n: count() })
    .from(schema.collectionEntries)
    .where(eq(schema.collectionEntries.userId, userId));
  if (n >= LIMITS.maxCollectionEntriesPerUser) {
    throw limitResponse("Collection entry limit reached.", false);
  }
  // Graded cards are metered by plan (free = a taste, Pro = unlimited). The whole
  // raw collection stays free; only graded (PSA) entries count against the cap.
  const grade = input.grade ?? "raw";
  if (grade !== "raw") {
    const plan = await getUserPlan(db, userId);
    const [{ g }] = await db
      .select({ g: count() })
      .from(schema.collectionEntries)
      .where(
        and(eq(schema.collectionEntries.userId, userId), ne(schema.collectionEntries.grade, "raw")),
      );
    if (g >= limitsFor(plan).maxGradedEntries) {
      throw limitResponse("Graded-card limit reached — upgrade to Pro for unlimited graded cards.");
    }
  }
  const id = crypto.randomUUID();
  await db.insert(schema.collectionEntries).values({
    id,
    userId,
    cardId: input.cardId,
    quantity: input.quantity,
    variant: input.variant,
    grade: input.grade ?? "raw",
    condition: input.condition,
    language: input.language,
    purchasePriceMinor: input.purchasePriceMinor,
    purchaseCurrency: MARKET_CURRENCY[market],
    purchaseDate: input.purchaseDate,
    notes: input.notes,
  });
  await bumpTrackedCounts(db, input.cardId, { collection: 1 });
  await invalidateProgressForCard(db, userId, input.cardId);
  return id;
}

export async function updateEntry(
  db: Database,
  userId: string,
  entryId: string,
  patch: Partial<EntryInput>,
): Promise<boolean> {
  const result = await db
    .update(schema.collectionEntries)
    .set({
      ...(patch.quantity !== undefined ? { quantity: patch.quantity } : {}),
      ...(patch.variant !== undefined ? { variant: patch.variant } : {}),
      ...(patch.grade !== undefined ? { grade: patch.grade } : {}),
      ...(patch.condition !== undefined ? { condition: patch.condition } : {}),
      ...(patch.language !== undefined ? { language: patch.language } : {}),
      ...(patch.purchasePriceMinor !== undefined
        ? { purchasePriceMinor: patch.purchasePriceMinor }
        : {}),
      ...(patch.purchaseDate !== undefined ? { purchaseDate: patch.purchaseDate } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    })
    .where(
      and(eq(schema.collectionEntries.id, entryId), eq(schema.collectionEntries.userId, userId)),
    )
    .returning({ cardId: schema.collectionEntries.cardId });
  if (result.length === 0) return false;
  await invalidateProgressForCard(db, userId, result[0].cardId);
  return true;
}

export async function deleteEntries(
  db: Database,
  userId: string,
  entryIds: string[],
): Promise<number> {
  if (entryIds.length === 0) return 0;
  const deleted = await db
    .delete(schema.collectionEntries)
    .where(
      and(
        eq(schema.collectionEntries.userId, userId),
        inArray(schema.collectionEntries.id, entryIds),
      ),
    )
    .returning({ cardId: schema.collectionEntries.cardId });
  for (const row of deleted) {
    await bumpTrackedCounts(db, row.cardId, { collection: -1 });
    await invalidateProgressForCard(db, userId, row.cardId);
  }
  return deleted.length;
}

/** Bulk-edit shared fields on selected entries (ownership enforced). */
export async function bulkUpdateEntries(
  db: Database,
  userId: string,
  entryIds: string[],
  patch: { condition?: (typeof schema.CONDITIONS)[number]; language?: string },
): Promise<number> {
  if (entryIds.length === 0 || (!patch.condition && !patch.language)) return 0;
  const result = await db
    .update(schema.collectionEntries)
    .set({
      ...(patch.condition ? { condition: patch.condition } : {}),
      ...(patch.language ? { language: patch.language } : {}),
    })
    .where(
      and(
        eq(schema.collectionEntries.userId, userId),
        inArray(schema.collectionEntries.id, entryIds),
      ),
    )
    .returning({ id: schema.collectionEntries.id });
  return result.length;
}

/** Variants with market evidence for a card (SPEC §10) — for entry forms. */
export async function availableVariants(db: Database, cardId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ variant: schema.cardPricesCurrent.variant })
    .from(schema.cardPricesCurrent)
    .where(eq(schema.cardPricesCurrent.cardId, cardId));
  return rows.map((r) => r.variant);
}

/** What the signed-in user already holds for a card: owned quantity (summed
 * across entries), the distinct variants owned, and whether it's on their
 * wishlist. Powers the catalog "you own this" badges (public card + list). */
export interface UserCardState {
  ownedQuantity: number;
  variants: string[];
  onWishlist: boolean;
}

/**
 * Batch ownership/wishlist lookup for the catalog badges. Returns a plain record
 * (serialization-safe across the loader boundary) keyed by card ID; cards the
 * user neither owns nor wishlisted are simply absent. Always scoped to userId.
 */
export async function getUserCardState(
  db: Database,
  userId: string,
  cardIds: string[],
): Promise<Record<string, UserCardState>> {
  const state: Record<string, UserCardState> = {};
  if (cardIds.length === 0) return state;
  const ensure = (cardId: string): UserCardState =>
    (state[cardId] ??= { ownedQuantity: 0, variants: [], onWishlist: false });

  const [owned, wished] = await Promise.all([
    db
      .select({
        cardId: schema.collectionEntries.cardId,
        variant: schema.collectionEntries.variant,
        quantity: schema.collectionEntries.quantity,
      })
      .from(schema.collectionEntries)
      .where(
        and(
          eq(schema.collectionEntries.userId, userId),
          inArray(schema.collectionEntries.cardId, cardIds),
        ),
      ),
    db
      .select({ cardId: schema.wishlistItems.cardId })
      .from(schema.wishlistItems)
      .where(
        and(
          eq(schema.wishlistItems.userId, userId),
          inArray(schema.wishlistItems.cardId, cardIds),
        ),
      ),
  ]);

  for (const row of owned) {
    const s = ensure(row.cardId);
    s.ownedQuantity += row.quantity;
    if (!s.variants.includes(row.variant)) s.variants.push(row.variant);
  }
  for (const row of wished) ensure(row.cardId).onWishlist = true;
  return state;
}
