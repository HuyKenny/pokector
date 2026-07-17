import { sql } from "drizzle-orm";

import { schema, type Database } from "../db/index.server";

/**
 * Maintain tracked_cards reference counts (price history follows tracked cards,
 * SPEC §17). Deltas may be negative; counts never drop below zero.
 */
export async function bumpTrackedCounts(
  db: Database,
  cardId: string,
  delta: { collection?: number; wishlist?: number },
): Promise<void> {
  const collection = delta.collection ?? 0;
  const wishlist = delta.wishlist ?? 0;
  await db
    .insert(schema.trackedCards)
    .values({
      cardId,
      collectionReferenceCount: Math.max(collection, 0),
      wishlistReferenceCount: Math.max(wishlist, 0),
    })
    .onConflictDoUpdate({
      target: schema.trackedCards.cardId,
      set: {
        collectionReferenceCount: sql`MAX(0, ${schema.trackedCards.collectionReferenceCount} + ${collection})`,
        wishlistReferenceCount: sql`MAX(0, ${schema.trackedCards.wishlistReferenceCount} + ${wishlist})`,
      },
    });
}
