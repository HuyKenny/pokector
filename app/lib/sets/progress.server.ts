/**
 * Set completion (SPEC §12). Collection data is the source of truth; the
 * set_progress_cache table only accelerates list views and is refreshed here.
 */

import { and, eq, gt, inArray, sql } from "drizzle-orm";

import { schema, type Database } from "../db/index.server";

export interface SetProgress {
  ownedCount: number;
  totalCount: number;
  missingCount: number;
  completionPercent: number;
  /** Estimated cost of missing cards (cheapest priced variant each); null when
   * no missing card has a price. */
  missingValueMinor: number | null;
  missingPricedCount: number;
  ownedCardIds: string[];
}

export async function computeSetProgress(
  db: Database,
  userId: string,
  setId: string,
): Promise<SetProgress> {
  const cards = await db
    .select({ id: schema.pokemonCards.id })
    .from(schema.pokemonCards)
    .where(and(eq(schema.pokemonCards.setId, setId), eq(schema.pokemonCards.active, true)));
  const cardIds = cards.map((c) => c.id);
  if (cardIds.length === 0) {
    return {
      ownedCount: 0,
      totalCount: 0,
      missingCount: 0,
      completionPercent: 0,
      missingValueMinor: null,
      missingPricedCount: 0,
      ownedCardIds: [],
    };
  }

  const ownedRows = await db
    .selectDistinct({ cardId: schema.collectionEntries.cardId })
    .from(schema.collectionEntries)
    .where(
      and(
        eq(schema.collectionEntries.userId, userId),
        gt(schema.collectionEntries.quantity, 0),
        inArray(schema.collectionEntries.cardId, cardIds),
      ),
    );
  const ownedSet = new Set(ownedRows.map((r) => r.cardId));
  const missingIds = cardIds.filter((id) => !ownedSet.has(id));

  let missingValueMinor: number | null = null;
  let missingPricedCount = 0;
  if (missingIds.length > 0) {
    const row = await db.get<{ total: number | null; priced: number }>(sql`
      SELECT SUM(p.min_price) AS total, COUNT(p.card_id) AS priced FROM (
        SELECT card_id, MIN(normalized_price_minor) AS min_price
        FROM card_prices_current
        WHERE source = 'tcgplayer' AND card_id IN ${missingIds}
        GROUP BY card_id
      ) p
    `);
    missingValueMinor = row?.total ?? null;
    missingPricedCount = row?.priced ?? 0;
  }

  const progress: SetProgress = {
    ownedCount: ownedSet.size,
    totalCount: cardIds.length,
    missingCount: missingIds.length,
    completionPercent: cardIds.length > 0 ? (ownedSet.size / cardIds.length) * 100 : 0,
    missingValueMinor,
    missingPricedCount,
    ownedCardIds: [...ownedSet],
  };

  // Refresh the cache row (collection remains the source of truth).
  await db
    .insert(schema.setProgressCache)
    .values({
      userId,
      setId,
      checklistMode: "standard",
      ownedCount: progress.ownedCount,
      totalCount: progress.totalCount,
      missingCount: progress.missingCount,
      missingValueMinor: progress.missingValueMinor,
      calculatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        schema.setProgressCache.userId,
        schema.setProgressCache.setId,
        schema.setProgressCache.checklistMode,
      ],
      set: {
        ownedCount: progress.ownedCount,
        totalCount: progress.totalCount,
        missingCount: progress.missingCount,
        missingValueMinor: progress.missingValueMinor,
        calculatedAt: new Date(),
      },
    });

  return progress;
}

/** Drop cached progress rows for the sets a card belongs to (on collection change). */
export async function invalidateProgressForCard(
  db: Database,
  userId: string,
  cardId: string,
): Promise<void> {
  await db.run(sql`
    DELETE FROM set_progress_cache
    WHERE user_id = ${userId}
      AND set_id = (SELECT set_id FROM pokemon_cards WHERE id = ${cardId})
  `);
}
