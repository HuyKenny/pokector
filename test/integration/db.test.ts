import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDb, schema } from "~/lib/db/index.server";

/** Drizzle wraps the SQLite error; the constraint name lives in the cause chain. */
async function expectUniqueViolation(promise: Promise<unknown>): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).not.toBeNull();
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  expect(messages.join(" | ")).toMatch(/UNIQUE constraint failed/i);
}

describe("D1 schema + drizzle", () => {
  it("applies migrations and supports catalog inserts/reads", async () => {
    const db = createDb(env.DB);
    const now = Date.now();

    await db
      .insert(schema.pokemonSets)
      .values({
        id: "test-set",
        slug: "test-set",
        name: "Test Set",
        nameNormalized: "test set",
        series: "Test",
        printedTotal: 10,
        total: 12,
        releaseDate: "2026-01-01",
        syncedAt: new Date(now),
      })
      .onConflictDoNothing();

    await db.insert(schema.pokemonCards).values({
      id: "test-set-1",
      slug: "test-set-1-testmon",
      setId: "test-set",
      name: "Testmon",
      nameNormalized: "testmon",
      number: "1",
      numberSort: 1,
      searchText: "testmon test set 1",
      syncedAt: new Date(now),
    });

    const card = await db.query.pokemonCards.findFirst({
      where: eq(schema.pokemonCards.id, "test-set-1"),
    });
    expect(card?.name).toBe("Testmon");
    expect(card?.active).toBe(true);
  });

  it("enforces one price-history observation per card/source/variant/currency/day", async () => {
    const db = createDb(env.DB);
    const row = {
      cardId: "test-set-1",
      source: "tcgplayer",
      variant: "normal",
      currency: "USD",
      priceMinor: 123,
      recordedDate: "2026-07-17",
      observedAt: new Date(),
    } as const;

    await db.insert(schema.cardPriceHistory).values(row);
    await expectUniqueViolation(db.insert(schema.cardPriceHistory).values(row));
  });

  it("keeps user data isolated by unique constraints (wishlist)", async () => {
    const db = createDb(env.DB);
    await db.insert(schema.user).values({
      id: "u1",
      name: "User One",
      email: "u1@example.com",
    });

    await db.insert(schema.wishlistItems).values({
      id: crypto.randomUUID(),
      userId: "u1",
      cardId: "test-set-1",
      variant: "normal",
      currency: "USD",
    });

    await expectUniqueViolation(
      db.insert(schema.wishlistItems).values({
        id: crypto.randomUUID(),
        userId: "u1",
        cardId: "test-set-1",
        variant: "normal",
        currency: "USD",
      }),
    );
  });
});
