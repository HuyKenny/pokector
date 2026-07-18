import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import {
  getUserPokedexOverlay,
  listPokedexAggregates,
  togglePokedexFavorite,
} from "~/lib/catalog/queries.server";
import { createDb, schema } from "~/lib/db/index.server";

const USER = "pokedex-user";

const db = createDb(env.DB);

async function seed() {
  await db
    .insert(schema.pokemonSets)
    .values({
      id: "dexset",
      slug: "dexset",
      name: "Dex Test Set",
      nameNormalized: "dex test set",
      series: "Test",
      syncedAt: new Date(),
    })
    .onConflictDoNothing();

  const cards = [
    { id: "dex-a", dex: "[6]" }, // Charizard
    { id: "dex-b", dex: "[6,7]" }, // multi-Pokémon card (counts for 6 AND 7)
    { id: "dex-c", dex: "[7]" }, // unpriced
    { id: "dex-d", dex: null }, // Trainer/Energy — excluded
  ];
  for (const c of cards) {
    await db
      .insert(schema.pokemonCards)
      .values({
        id: c.id,
        slug: `${c.id}-card`,
        setId: "dexset",
        name: c.id,
        nameNormalized: c.id,
        number: "1",
        numberSort: 1,
        searchText: c.id,
        nationalPokedexNumbersJson: c.dex,
        syncedAt: new Date(),
      })
      .onConflictDoNothing();
  }

  const prices: [string, string, number][] = [
    ["dex-a", "holofoil", 20000], // $200
    ["dex-a", "normal", 15000], // lower variant — MAX-per-card must ignore it
    ["dex-b", "holofoil", 40000], // $400
    // dex-c intentionally unpriced
  ];
  for (const [cardId, variant, minor] of prices) {
    await db
      .insert(schema.cardPricesCurrent)
      .values({
        cardId,
        source: "tcgplayer",
        variant: variant as (typeof schema.CARD_VARIANTS)[number],
        currency: "USD",
        normalizedPriceMinor: minor,
        observedAt: new Date(),
      })
      .onConflictDoNothing();
  }

  await db
    .insert(schema.user)
    .values({ id: USER, name: USER, email: "pokedex@test" })
    .onConflictDoNothing();
  // User owns Charizard (dex-a, dex 6).
  await db
    .insert(schema.collectionEntries)
    .values({ id: "dex-entry-1", userId: USER, cardId: "dex-a", quantity: 1, variant: "holofoil" })
    .onConflictDoNothing();
}

describe("listPokedexAggregates", () => {
  beforeAll(seed);

  it("counts cards per dex (incl. multi-Pokémon cards) and averages one price per card", async () => {
    const agg = await listPokedexAggregates(db);

    // dex 6: cards A + B → count 2. Per-card price uses MAX variant (A=200 not
    // 150), so avg = (20000 + 40000) / 2 = 30000.
    expect(agg.get(6)).toEqual({ cardCount: 2, avgPriceMinor: 30000 });

    // dex 7: cards B + C → count 2, but only B is priced → avg = 40000.
    expect(agg.get(7)).toEqual({ cardCount: 2, avgPriceMinor: 40000 });

    // Trainer/Energy (null dex) contributes to nothing.
    expect(agg.get(999)).toBeUndefined();
  });

  it("computes per-user owned counts and toggles favourites", async () => {
    const overlay = await getUserPokedexOverlay(db, USER);
    // Owns 1 distinct Charizard (dex 6) card; nothing for dex 7.
    expect(overlay.owned[6]).toBe(1);
    expect(overlay.owned[7]).toBeUndefined();
    expect(overlay.favorites).toEqual([]);

    // Toggle dex 6 on, then off.
    expect(await togglePokedexFavorite(db, USER, 6)).toBe(true);
    expect((await getUserPokedexOverlay(db, USER)).favorites).toEqual([6]);
    expect(await togglePokedexFavorite(db, USER, 6)).toBe(false);
    expect((await getUserPokedexOverlay(db, USER)).favorites).toEqual([]);
  });
});
