/**
 * Set completion (SPEC §12). Collection data is the source of truth; the
 * set_progress_cache table only accelerates list views and is refreshed here.
 */

import { and, count, eq, gt, sql } from "drizzle-orm";

import { schema, type Database } from "../db/index.server";
import { MARKET_SOURCE, type Market } from "../market/market";

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
  market: Market,
): Promise<SetProgress> {
  // Total active cards + owned card IDs are independent — run in parallel.
  // (JOIN on set_id, not an IN list of every card.)
  const [totalRows, ownedRows] = await Promise.all([
    db
      .select({ total: count() })
      .from(schema.pokemonCards)
      .where(and(eq(schema.pokemonCards.setId, setId), eq(schema.pokemonCards.active, true))),
    db
      .selectDistinct({ cardId: schema.collectionEntries.cardId })
      .from(schema.collectionEntries)
      .innerJoin(schema.pokemonCards, eq(schema.collectionEntries.cardId, schema.pokemonCards.id))
      .where(
        and(
          eq(schema.collectionEntries.userId, userId),
          gt(schema.collectionEntries.quantity, 0),
          eq(schema.pokemonCards.setId, setId),
        ),
      ),
  ]);
  const totalCount = totalRows[0].total;
  if (totalCount === 0) {
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

  const ownedSet = new Set(ownedRows.map((r) => r.cardId));
  const missingCount = totalCount - ownedSet.size;

  // Missing-card value: cheapest priced variant of each set card the user does
  // NOT own — computed entirely in SQL (no per-card parameters).
  let missingValueMinor: number | null = null;
  let missingPricedCount = 0;
  if (missingCount > 0) {
    const row = await db.get<{ total: number | null; priced: number }>(sql`
      SELECT SUM(p.min_price) AS total, COUNT(p.card_id) AS priced FROM (
        SELECT pc.card_id, MIN(pc.normalized_price_minor) AS min_price
        FROM card_prices_current pc
        JOIN pokemon_cards k ON k.id = pc.card_id
        WHERE pc.source = ${MARKET_SOURCE[market]} AND k.set_id = ${setId} AND k.active = 1
          AND pc.card_id NOT IN (
            SELECT DISTINCT e.card_id FROM collection_entries e
            JOIN pokemon_cards k2 ON k2.id = e.card_id
            WHERE e.user_id = ${userId} AND k2.set_id = ${setId} AND e.quantity > 0
          )
        GROUP BY pc.card_id
      ) p
    `);
    missingValueMinor = row?.total ?? null;
    missingPricedCount = row?.priced ?? 0;
  }

  const progress: SetProgress = {
    ownedCount: ownedSet.size,
    totalCount,
    missingCount,
    completionPercent: totalCount > 0 ? (ownedSet.size / totalCount) * 100 : 0,
    missingValueMinor,
    missingPricedCount,
    ownedCardIds: [...ownedSet],
  };

  // Refresh the cache row (collection remains the source of truth). The
  // missing-value is currency-specific, so it lives in a per-market column; the
  // counts are market-independent. We only touch the active market's value
  // column, leaving the other market's cached value intact.
  const valueCol =
    market === "us"
      ? { missingValueMinor: progress.missingValueMinor }
      : { missingValueMinorEur: progress.missingValueMinor };
  await db
    .insert(schema.setProgressCache)
    .values({
      userId,
      setId,
      checklistMode: "standard",
      ownedCount: progress.ownedCount,
      totalCount: progress.totalCount,
      missingCount: progress.missingCount,
      ...valueCol,
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
        ...valueCol,
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
