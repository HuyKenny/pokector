/**
 * Binder repository (SPEC §11). Ownership enforced on every mutation; public
 * reads are sanitized — no purchase prices, notes, e-mails, or account data.
 * Share slugs are 128-bit crypto-random, regenerable, revocable.
 */

import { and, asc, count, eq, sql } from "drizzle-orm";

import { LIMITS, limitResponse, limitsFor } from "../limits";
import { getUserPlan } from "../billing/entitlement.server";
import { schema, type Database } from "../db/index.server";

export type BinderVisibility = "private" | "unlisted" | "public";

function shareSlug(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export async function listBinders(db: Database, userId: string) {
  return db.all<{
    id: string;
    name: string;
    description: string | null;
    visibility: BinderVisibility;
    public_slug: string | null;
    card_count: number;
    page_count: number;
  }>(sql`
    SELECT b.id, b.name, b.description, b.visibility, b.public_slug,
           (SELECT COUNT(*) FROM binder_slots s WHERE s.binder_id = b.id AND s.card_id IS NOT NULL) AS card_count,
           COALESCE((SELECT MAX(s.page_number) FROM binder_slots s WHERE s.binder_id = b.id), 0) AS page_count
    FROM binders b WHERE b.user_id = ${userId}
    ORDER BY b.created_at ASC
  `);
}

export async function createBinder(
  db: Database,
  userId: string,
  name: string,
  description: string | null,
) {
  const [{ n }] = await db
    .select({ n: count() })
    .from(schema.binders)
    .where(eq(schema.binders.userId, userId));
  const plan = await getUserPlan(db, userId);
  if (n >= limitsFor(plan).maxBinders) {
    throw limitResponse("Binder limit reached.");
  }
  const id = crypto.randomUUID();
  await db.insert(schema.binders).values({ id, userId, name, description });
  return id;
}

/** Returns the binder only when owned by userId (BOLA defense). */
export async function getOwnedBinder(db: Database, userId: string, binderId: string) {
  return db.query.binders.findFirst({
    where: and(eq(schema.binders.id, binderId), eq(schema.binders.userId, userId)),
  });
}

export async function updateBinder(
  db: Database,
  userId: string,
  binderId: string,
  patch: {
    name?: string;
    description?: string | null;
    visibility?: BinderVisibility;
    regenerateSlug?: boolean;
  },
): Promise<boolean> {
  const binder = await getOwnedBinder(db, userId, binderId);
  if (!binder) return false;

  let publicSlug = binder.publicSlug;
  const visibility = patch.visibility ?? binder.visibility;
  if (visibility === "private") publicSlug = null;
  else if (!publicSlug || patch.regenerateSlug) publicSlug = shareSlug();

  await db
    .update(schema.binders)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      visibility,
      publicSlug,
    })
    .where(and(eq(schema.binders.id, binderId), eq(schema.binders.userId, userId)));
  return true;
}

export async function deleteBinder(
  db: Database,
  userId: string,
  binderId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(schema.binders)
    .where(and(eq(schema.binders.id, binderId), eq(schema.binders.userId, userId)))
    .returning({ id: schema.binders.id });
  return deleted.length > 0;
}

export interface BinderSlotView {
  id: string;
  pageNumber: number;
  side: "front" | "back";
  slotNumber: number;
  cardId: string | null;
  collectionEntryId: string | null;
  cardName: string | null;
  cardSlug: string | null;
  imageSmallUrl: string | null;
}

export async function getBinderSlots(db: Database, binderId: string): Promise<BinderSlotView[]> {
  const rows = await db
    .select({
      id: schema.binderSlots.id,
      pageNumber: schema.binderSlots.pageNumber,
      side: schema.binderSlots.side,
      slotNumber: schema.binderSlots.slotNumber,
      cardId: schema.binderSlots.cardId,
      collectionEntryId: schema.binderSlots.collectionEntryId,
      cardName: schema.pokemonCards.name,
      cardSlug: schema.pokemonCards.slug,
      imageSmallUrl: schema.pokemonCards.imageSmallUrl,
    })
    .from(schema.binderSlots)
    .leftJoin(schema.pokemonCards, eq(schema.binderSlots.cardId, schema.pokemonCards.id))
    .where(eq(schema.binderSlots.binderId, binderId))
    .orderBy(
      asc(schema.binderSlots.pageNumber),
      asc(schema.binderSlots.side),
      asc(schema.binderSlots.slotNumber),
    );
  return rows;
}

/** Place a collection entry into a slot (creates/replaces the slot row). */
export async function placeInSlot(
  db: Database,
  userId: string,
  binderId: string,
  position: { pageNumber: number; side: "front" | "back"; slotNumber: number },
  collectionEntryId: string,
): Promise<{ ok: boolean; message: string }> {
  const binder = await getOwnedBinder(db, userId, binderId);
  if (!binder) return { ok: false, message: "Binder not found." };
  if (
    position.pageNumber < 1 ||
    position.pageNumber > LIMITS.maxBinderPages ||
    position.slotNumber < 1 ||
    position.slotNumber > 9
  ) {
    return { ok: false, message: "Invalid slot position." };
  }

  // The entry must belong to the same user (never place someone else's card).
  const entry = await db.query.collectionEntries.findFirst({
    where: and(
      eq(schema.collectionEntries.id, collectionEntryId),
      eq(schema.collectionEntries.userId, userId),
    ),
    columns: { id: true, cardId: true },
  });
  if (!entry) return { ok: false, message: "Collection entry not found." };

  await db
    .insert(schema.binderSlots)
    .values({
      id: crypto.randomUUID(),
      binderId,
      collectionEntryId: entry.id,
      cardId: entry.cardId,
      pageNumber: position.pageNumber,
      side: position.side,
      slotNumber: position.slotNumber,
    })
    .onConflictDoUpdate({
      target: [
        schema.binderSlots.binderId,
        schema.binderSlots.pageNumber,
        schema.binderSlots.side,
        schema.binderSlots.slotNumber,
      ],
      set: { collectionEntryId: entry.id, cardId: entry.cardId },
    });
  return { ok: true, message: "Card placed." };
}

/** Empty a slot (the collection entry itself is untouched — SPEC §11). */
export async function clearSlot(
  db: Database,
  userId: string,
  binderId: string,
  slotId: string,
): Promise<boolean> {
  const binder = await getOwnedBinder(db, userId, binderId);
  if (!binder) return false;
  const deleted = await db
    .delete(schema.binderSlots)
    .where(and(eq(schema.binderSlots.id, slotId), eq(schema.binderSlots.binderId, binderId)))
    .returning({ id: schema.binderSlots.id });
  return deleted.length > 0;
}

/** Swap the contents of two slots (also serves as "move to empty slot"). */
export async function moveSlot(
  db: Database,
  userId: string,
  binderId: string,
  from: { pageNumber: number; side: "front" | "back"; slotNumber: number },
  to: { pageNumber: number; side: "front" | "back"; slotNumber: number },
): Promise<boolean> {
  const binder = await getOwnedBinder(db, userId, binderId);
  if (!binder) return false;

  const slots = await getBinderSlots(db, binderId);
  const fromSlot = slots.find(
    (s) =>
      s.pageNumber === from.pageNumber && s.side === from.side && s.slotNumber === from.slotNumber,
  );
  if (!fromSlot?.collectionEntryId) return false;
  const toSlot = slots.find(
    (s) => s.pageNumber === to.pageNumber && s.side === to.side && s.slotNumber === to.slotNumber,
  );

  // Remove both rows, re-insert swapped (unique constraint safe).
  await db.delete(schema.binderSlots).where(eq(schema.binderSlots.id, fromSlot.id));
  if (toSlot) await db.delete(schema.binderSlots).where(eq(schema.binderSlots.id, toSlot.id));

  await db.insert(schema.binderSlots).values({
    id: crypto.randomUUID(),
    binderId,
    collectionEntryId: fromSlot.collectionEntryId,
    cardId: fromSlot.cardId,
    pageNumber: to.pageNumber,
    side: to.side,
    slotNumber: to.slotNumber,
  });
  if (toSlot?.collectionEntryId) {
    await db.insert(schema.binderSlots).values({
      id: crypto.randomUUID(),
      binderId,
      collectionEntryId: toSlot.collectionEntryId,
      cardId: toSlot.cardId,
      pageNumber: from.pageNumber,
      side: from.side,
      slotNumber: from.slotNumber,
    });
  }
  return true;
}

/** Swap two whole pages (front+back travel together). */
export async function swapPages(
  db: Database,
  userId: string,
  binderId: string,
  pageA: number,
  pageB: number,
): Promise<boolean> {
  const binder = await getOwnedBinder(db, userId, binderId);
  if (!binder || pageA === pageB) return false;
  // Three-step swap through a temporary page number outside the limit range.
  const TEMP = LIMITS.maxBinderPages + 1000;
  await db.run(
    sql`UPDATE binder_slots SET page_number = ${TEMP} WHERE binder_id = ${binderId} AND page_number = ${pageA}`,
  );
  await db.run(
    sql`UPDATE binder_slots SET page_number = ${pageA} WHERE binder_id = ${binderId} AND page_number = ${pageB}`,
  );
  await db.run(
    sql`UPDATE binder_slots SET page_number = ${pageB} WHERE binder_id = ${binderId} AND page_number = ${TEMP}`,
  );
  return true;
}

/**
 * Public/unlisted binder view — sanitized (no purchase data, notes, or owner
 * identifiers beyond a display name). 404-style null for private/unknown.
 */
export async function getPublicBinder(db: Database, publicSlug: string) {
  const binder = await db.query.binders.findFirst({
    where: eq(schema.binders.publicSlug, publicSlug),
  });
  if (!binder || binder.visibility === "private") return null;

  const [slots, profile] = await Promise.all([
    getBinderSlots(db, binder.id),
    db.query.userProfiles.findFirst({
      where: eq(schema.userProfiles.userId, binder.userId),
      columns: { displayName: true },
    }),
  ]);

  return {
    name: binder.name,
    description: binder.description,
    visibility: binder.visibility,
    ownerDisplayName: profile?.displayName ?? "A collector",
    slots: slots.map((slot) => ({
      pageNumber: slot.pageNumber,
      side: slot.side,
      slotNumber: slot.slotNumber,
      cardName: slot.cardName,
      cardSlug: slot.cardSlug,
      imageSmallUrl: slot.imageSmallUrl,
    })),
  };
}
