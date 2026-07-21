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
  // Raw (Cardmarket holofoil) = €150 — the EU-market price world.
  await db
    .insert(schema.cardPricesCurrent)
    .values({
      cardId: "g-charizard",
      source: "cardmarket",
      variant: "holofoil",
      currency: "EUR",
      normalizedPriceMinor: 15000,
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
    }, "us");
    let summary = await computeUserPortfolio(db, USER, "us");
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
    }, "us");
    summary = await computeUserPortfolio(db, USER, "us");
    expect(summary.marketValueMinor).toBe(20000 + 90000);
  });

  it("EU market values raw by Cardmarket/EUR and treats graded as unpriced", async () => {
    // USER now holds the raw holofoil + a PSA 10 (added above). In the EU market
    // the raw entry is worth its Cardmarket price (€150) and the graded entry —
    // which only has a USD eBay price — must NOT contribute to the EUR total.
    const summary = await computeUserPortfolio(db, USER, "eu");
    expect(summary.marketValueMinor).toBe(15000);
    // The graded entry reads as unpriced in EU (no EUR value).
    expect(summary.unpricedEntryCount).toBe(1);
  });
});
