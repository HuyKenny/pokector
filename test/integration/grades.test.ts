import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { addEntry } from "~/lib/collection/queries.server";
import { createDb, schema } from "~/lib/db/index.server";
import { computeUserPortfolio } from "~/lib/portfolio/queries.server";

const db = createDb(env.DB);
const USER = "grade-user";

async function seed() {
  await db
    .insert(schema.user)
    .values({ id: USER, name: USER, email: "grade@test" })
    .onConflictDoNothing();
  await db
    .insert(schema.pokemonSets)
    .values({
      id: "gset",
      slug: "gset",
      name: "Grade Set",
      nameNormalized: "grade set",
      series: "Test",
      syncedAt: new Date(),
    })
    .onConflictDoNothing();
  await db
    .insert(schema.pokemonCards)
    .values({
      id: "g-charizard",
      slug: "g-charizard",
      setId: "gset",
      name: "Charizard",
      nameNormalized: "charizard",
      number: "4",
      numberSort: 4,
      searchText: "charizard",
      syncedAt: new Date(),
    })
    .onConflictDoNothing();
  // Raw (TCGplayer holofoil) = $200; PSA 10 (eBay graded) = $900.
  await db
    .insert(schema.cardPricesCurrent)
    .values({
      cardId: "g-charizard",
      source: "tcgplayer",
      variant: "holofoil",
      currency: "USD",
      normalizedPriceMinor: 20000,
      observedAt: new Date(),
    })
    .onConflictDoNothing();
  await db
    .insert(schema.cardGradedPrices)
    .values({ cardId: "g-charizard", grade: "psa10", currency: "USD", fromMinor: 90000, observedAt: new Date() })
    .onConflictDoNothing();
}

describe("grade-aware valuation", () => {
  beforeAll(seed);

  it("values a raw entry by TCGplayer and a PSA 10 entry by the graded price", async () => {
    // Raw holofoil entry → $200.
    await addEntry(db, USER, {
      cardId: "g-charizard",
      quantity: 1,
      variant: "holofoil",
      grade: "raw",
      condition: "Near Mint",
      language: "English",
      purchasePriceMinor: null,
      purchaseDate: null,
      notes: null,
    });
    let summary = await computeUserPortfolio(db, USER);
    expect(summary.marketValueMinor).toBe(20000);

    // Add a PSA 10 entry → +$900 (graded price, NOT the raw $200).
    await addEntry(db, USER, {
      cardId: "g-charizard",
      quantity: 1,
      variant: "holofoil",
      grade: "psa10",
      condition: "Near Mint",
      language: "English",
      purchasePriceMinor: null,
      purchaseDate: null,
      notes: null,
    });
    summary = await computeUserPortfolio(db, USER);
    expect(summary.marketValueMinor).toBe(20000 + 90000);
  });
});
