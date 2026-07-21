import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { createDb, schema } from "~/lib/db/index.server";
import {
  clearSlot,
  createBinder,
  deleteBinder,
  getBinderSlots,
  getPublicBinder,
  moveSlot,
  placeInSlot,
  updateBinder,
} from "~/lib/binders/queries.server";
import { addEntry } from "~/lib/collection/queries.server";

const db = createDb(env.DB);
const OWNER = "bind-owner";
const INTRUDER = "bind-intruder";

let binderId: string;
let entryId: string;

describe("binders: ownership, slots, privacy", () => {
  beforeAll(async () => {
    for (const [id, email] of [
      [OWNER, "owner@bind.test"],
      [INTRUDER, "intruder@bind.test"],
    ] as const) {
      await db.insert(schema.user).values({ id, name: id, email }).onConflictDoNothing();
      await db
        .insert(schema.userProfiles)
        .values({ userId: id, displayName: id })
        .onConflictDoNothing();
    }
    await db
      .insert(schema.pokemonSets)
      .values({
        id: "bset",
        slug: "bset",
        name: "Binder Set",
        nameNormalized: "binder set",
        series: "T",
        syncedAt: new Date(),
      })
      .onConflictDoNothing();
    await db
      .insert(schema.pokemonCards)
      .values({
        id: "bset-1",
        slug: "bset-1-bindermon",
        setId: "bset",
        name: "Bindermon",
        nameNormalized: "bindermon",
        number: "1",
        numberSort: 1,
        searchText: "bindermon",
        syncedAt: new Date(),
      })
      .onConflictDoNothing();

    binderId = await createBinder(db, OWNER, "Trade binder", "with secrets");
    entryId = await addEntry(db, OWNER, {
      cardId: "bset-1",
      quantity: 1,
      variant: "normal",
      condition: "Near Mint",
      language: "English",
      purchasePriceMinor: 99999, // private!
      purchaseDate: "2026-01-01",
      notes: "super secret note", // private!
    }, "us");
  });

  it("places, moves, and clears slots; entry survives slot clearing", async () => {
    const placed = await placeInSlot(
      db,
      OWNER,
      binderId,
      { pageNumber: 1, side: "front", slotNumber: 5 },
      entryId,
    );
    expect(placed.ok).toBe(true);

    expect(
      await moveSlot(
        db,
        OWNER,
        binderId,
        { pageNumber: 1, side: "front", slotNumber: 5 },
        { pageNumber: 2, side: "back", slotNumber: 1 },
      ),
    ).toBe(true);
    const slots = await getBinderSlots(db, binderId);
    const slot = slots.find((s) => s.cardId === "bset-1");
    expect(slot?.pageNumber).toBe(2);
    expect(slot?.side).toBe("back");

    expect(await clearSlot(db, OWNER, binderId, slot!.id)).toBe(true);
    // Collection entry untouched.
    const entry = await db.query.collectionEntries.findFirst({
      where: (t, { eq }) => eq(t.id, entryId),
    });
    expect(entry).toBeDefined();
  });

  it("blocks other users from every binder mutation (BOLA)", async () => {
    expect(
      (
        await placeInSlot(
          db,
          INTRUDER,
          binderId,
          { pageNumber: 1, side: "front", slotNumber: 1 },
          entryId,
        )
      ).ok,
    ).toBe(false);
    expect(await updateBinder(db, INTRUDER, binderId, { name: "hacked" })).toBe(false);
    expect(await deleteBinder(db, INTRUDER, binderId)).toBe(false);
    // Intruder also can't place THEIR binder with OWNER's entry.
    const intruderBinder = await createBinder(db, INTRUDER, "mine", null);
    expect(
      (
        await placeInSlot(
          db,
          INTRUDER,
          intruderBinder,
          { pageNumber: 1, side: "front", slotNumber: 1 },
          entryId,
        )
      ).ok,
    ).toBe(false);
  });

  it("private binders have no public view; shared views hide private data", async () => {
    // Private → no slug, no public view.
    let binder = await db.query.binders.findFirst({ where: (t, { eq }) => eq(t.id, binderId) });
    expect(binder?.publicSlug).toBeNull();

    // Unlisted → slug appears; public view is sanitized.
    await placeInSlot(
      db,
      OWNER,
      binderId,
      { pageNumber: 1, side: "front", slotNumber: 1 },
      entryId,
    );
    await updateBinder(db, OWNER, binderId, { visibility: "unlisted" });
    binder = await db.query.binders.findFirst({ where: (t, { eq }) => eq(t.id, binderId) });
    expect(binder?.publicSlug).toMatch(/^[A-Za-z0-9_-]{20,}$/);

    const view = await getPublicBinder(db, binder!.publicSlug!);
    expect(view).not.toBeNull();
    const json = JSON.stringify(view);
    expect(json).not.toContain("99999");
    expect(json).not.toContain("super secret note");
    expect(json).not.toContain("owner@bind.test");

    // Regenerating invalidates the old link.
    const oldSlug = binder!.publicSlug!;
    await updateBinder(db, OWNER, binderId, { regenerateSlug: true });
    expect(await getPublicBinder(db, oldSlug)).toBeNull();

    // Back to private → link disabled entirely.
    await updateBinder(db, OWNER, binderId, { visibility: "private" });
    binder = await db.query.binders.findFirst({ where: (t, { eq }) => eq(t.id, binderId) });
    expect(binder?.publicSlug).toBeNull();
  });
});
