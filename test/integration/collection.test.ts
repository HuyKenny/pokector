import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { createDb, schema } from "~/lib/db/index.server";
import {
  addEntry,
  deleteEntries,
  listCollection,
  updateEntry,
} from "~/lib/collection/queries.server";
import { computeUserPortfolio, writePortfolioSnapshot } from "~/lib/portfolio/queries.server";

const db = createDb(env.DB);
const USER_A = "col-user-a";
const USER_B = "col-user-b";

async function seed() {
  for (const [id, email] of [
    [USER_A, "a@col.test"],
    [USER_B, "b@col.test"],
  ] as const) {
    await db.insert(schema.user).values({ id, name: id, email }).onConflictDoNothing();
  }
  await db
    .insert(schema.pokemonSets)
    .values({
      id: "colset",
      slug: "colset",
      name: "Collection Test Set",
      nameNormalized: "collection test set",
      series: "Test",
      syncedAt: new Date(),
    })
    .onConflictDoNothing();
  for (const n of [1, 2]) {
    await db
      .insert(schema.pokemonCards)
      .values({
        id: `colset-${n}`,
        slug: `colset-${n}-testcard`,
        setId: "colset",
        name: `Testcard ${n}`,
        nameNormalized: `testcard ${n}`,
        number: String(n),
        numberSort: n,
        searchText: `testcard ${n} colset`,
        syncedAt: new Date(),
      })
      .onConflictDoNothing();
  }
  // colset-1 holofoil priced at $10.00; colset-2 unpriced.
  await db
    .insert(schema.cardPricesCurrent)
    .values({
      cardId: "colset-1",
      source: "tcgplayer",
      variant: "holofoil",
      currency: "USD",
      normalizedPriceMinor: 1000,
      observedAt: new Date(),
    })
    .onConflictDoNothing();
}

describe("collection CRUD + portfolio", () => {
  beforeAll(seed);

  it("adds, lists, updates, deletes with ownership isolation", async () => {
    const entryId = await addEntry(db, USER_A, {
      cardId: "colset-1",
      quantity: 2,
      variant: "holofoil",
      condition: "Near Mint",
      language: "English",
      purchasePriceMinor: 400,
      purchaseDate: "2026-01-15",
      notes: "trade with Mia",
    });

    const listA = await listCollection(db, USER_A, {});
    expect(listA.total).toBe(1);
    expect(listA.items[0].currentPriceMinor).toBe(1000);

    // User B sees nothing and cannot modify A's entry.
    const listB = await listCollection(db, USER_B, {});
    expect(listB.total).toBe(0);
    expect(await updateEntry(db, USER_B, entryId, { quantity: 999 })).toBe(false);
    expect(await deleteEntries(db, USER_B, [entryId])).toBe(0);

    // Owner can update.
    expect(await updateEntry(db, USER_A, entryId, { quantity: 3 })).toBe(true);
    const after = await db.query.collectionEntries.findFirst({
      where: eq(schema.collectionEntries.id, entryId),
    });
    expect(after?.quantity).toBe(3);

    // Tracked counts follow collection references.
    const tracked = await db.query.trackedCards.findFirst({
      where: eq(schema.trackedCards.cardId, "colset-1"),
    });
    expect((tracked?.collectionReferenceCount ?? 0) >= 1).toBe(true);
  });

  it("portfolio: variant must match exactly; unpriced never becomes zero silently", async () => {
    // Same card but "normal" variant — no price row for normal → unpriced.
    await addEntry(db, USER_A, {
      cardId: "colset-1",
      quantity: 1,
      variant: "normal",
      condition: "Near Mint",
      language: "English",
      purchasePriceMinor: null,
      purchaseDate: null,
      notes: null,
    });
    // Unpriced card entirely.
    await addEntry(db, USER_A, {
      cardId: "colset-2",
      quantity: 5,
      variant: "normal",
      condition: "Lightly Played",
      language: "English",
      purchasePriceMinor: 100,
      purchaseDate: null,
      notes: null,
    });

    const summary = await computeUserPortfolio(db, USER_A);
    // Only the holofoil entry (3 × $10) is priced.
    expect(summary.marketValueMinor).toBe(3000);
    expect(summary.unpricedEntryCount).toBe(2);
    // Cost basis includes holofoil (3×400) + colset-2 (5×100).
    expect(summary.costBasisMinor).toBe(1700);
    // P/L only over the matched holofoil entry: 3000 - 1200.
    expect(summary.unrealizedPlMinor).toBe(1800);
  });

  it("snapshots are idempotent per (user, day, currency)", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await writePortfolioSnapshot(db, USER_A, today);
    await writePortfolioSnapshot(db, USER_A, today); // second run must not duplicate

    const rows = await db
      .select()
      .from(schema.portfolioSnapshots)
      .where(eq(schema.portfolioSnapshots.userId, USER_A));
    expect(rows.filter((r) => r.snapshotDate === today)).toHaveLength(1);
    expect(rows[0].marketValueMinor).toBe(3000);
  });
});
