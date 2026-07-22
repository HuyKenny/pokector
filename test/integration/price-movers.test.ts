import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { getPriceMovers, getPriceMoversBoth } from "~/lib/catalog/queries.server";
import { createDb, schema } from "~/lib/db/index.server";

const db = createDb(env.DB);

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

async function seed() {
  await db
    .insert(schema.pokemonSets)
    .values({
      id: "mvset",
      slug: "mvset",
      name: "Movers Set",
      nameNormalized: "movers set",
      series: "Test",
      syncedAt: new Date(),
    })
    .onConflictDoNothing();

  // up: +100%, down: -50%, flat: unchanged (excluded).
  const cards: [string, number, number][] = [
    ["mv-up", 10000, 20000],
    ["mv-down", 20000, 10000],
    ["mv-flat", 10000, 10000],
  ];
  const prevDate = daysAgo(40); // older than both window starts (7d and 30d)
  for (const [id, prev, current] of cards) {
    await db
      .insert(schema.pokemonCards)
      .values({
        id,
        slug: `${id}-card`,
        setId: "mvset",
        name: id,
        nameNormalized: id,
        number: "1",
        numberSort: 1,
        searchText: id,
        syncedAt: new Date(),
      })
      .onConflictDoNothing();
    await db
      .insert(schema.cardPricesCurrent)
      .values({
        cardId: id,
        source: "tcgplayer",
        variant: "holofoil",
        currency: "USD",
        normalizedPriceMinor: current,
        observedAt: new Date(),
      })
      .onConflictDoNothing();
    await db
      .insert(schema.cardPriceHistory)
      .values({
        cardId: id,
        source: "tcgplayer",
        variant: "holofoil",
        currency: "USD",
        priceMinor: prev,
        recordedDate: prevDate,
        observedAt: new Date(),
      })
      .onConflictDoNothing();
  }
}

describe("getPriceMoversBoth", () => {
  beforeAll(seed);

  it("matches two separate getPriceMovers calls (parity), single window pass", async () => {
    const [up, down, both] = await Promise.all([
      getPriceMovers(db, 7, "up", 5, "us"),
      getPriceMovers(db, 7, "down", 5, "us"),
      getPriceMoversBoth(db, 7, 5, "us"),
    ]);
    // Same cards, same order as the two-query version.
    expect(both.up.map((m) => m.cardId)).toEqual(up.map((m) => m.cardId));
    expect(both.down.map((m) => m.cardId)).toEqual(down.map((m) => m.cardId));
    // Sanity: the gainer is up, the loser is down, the flat card is in neither.
    expect(both.up[0]?.cardId).toBe("mv-up");
    expect(both.down[0]?.cardId).toBe("mv-down");
    const all = [...both.up, ...both.down].map((m) => m.cardId);
    expect(all).not.toContain("mv-flat");
  });

  it("serves the cached result within the TTL (stale after underlying change)", async () => {
    const first = await getPriceMoversBoth(db, 30, 5, "us");
    expect(first.up[0]?.cardId).toBe("mv-up");

    // Change mv-up's current price so a fresh computation would differ…
    await db
      .update(schema.cardPricesCurrent)
      .set({ normalizedPriceMinor: 99999 })
      .where(eq(schema.cardPricesCurrent.cardId, "mv-up"));

    // …but the cached (kind, market, limit) entry is returned unchanged.
    const second = await getPriceMoversBoth(db, 30, 5, "us");
    expect(second.up[0]?.currentMinor).toBe(first.up[0]?.currentMinor);
  });
});
