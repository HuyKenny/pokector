import { describe, expect, it } from "vitest";

import {
  normalizeRiftboundCard,
  normalizeRiftboundSet,
  resolveRiftboundGameId,
} from "~/lib/riftbound/normalize";

const SYNCED = new Date("2026-07-22T00:00:00Z");
const GAME = "riftbound-league-of-legends-trading-card-game";

describe("resolveRiftboundGameId", () => {
  it("matches Riftbound by id or name (case-insensitive)", () => {
    expect(
      resolveRiftboundGameId([
        { id: "pokemon", name: "Pokémon" },
        { id: GAME, name: "Riftbound: League of Legends Trading Card Game" },
      ]),
    ).toBe(GAME);
    expect(resolveRiftboundGameId([{ id: "lol-tcg", name: "League of Legends TCG" }])).toBe(
      "lol-tcg",
    );
  });
  it("returns null when no game matches", () => {
    expect(resolveRiftboundGameId([{ id: "mtg", name: "Magic" }])).toBeNull();
  });
});

describe("normalizeRiftboundSet", () => {
  it("strips the game-id suffix into a clean slug and trims the release date", () => {
    const set = normalizeRiftboundSet(
      { id: `origins-${GAME}`, name: "Origins", release_date: "2025-10-31T00:00:00.000Z" },
      SYNCED,
      GAME,
    )!;
    expect(set).toMatchObject({
      id: `origins-${GAME}`,
      slug: "origins",
      name: "Origins",
      code: null,
      releaseDate: "2025-10-31",
      active: true,
    });
  });
  it("returns null without id or name", () => {
    expect(normalizeRiftboundSet({ name: "No id" }, SYNCED, GAME)).toBeNull();
  });
});

describe("normalizeRiftboundCard", () => {
  it("maps a card, builds TCGplayer images, and picks Near Mint per printing", () => {
    const out = normalizeRiftboundCard(
      {
        id: `${GAME}-origins-jinx-001`,
        name: "Jinx",
        set: `origins-${GAME}`,
        set_name: "Origins",
        number: "1/298",
        rarity: "Epic",
        tcgplayerId: "653094",
        variants: [
          { printing: "Normal", condition: "Lightly Played", price: 5 },
          {
            printing: "Normal",
            condition: "Near Mint",
            price: 12.5,
            minPrice7d: 10,
            avgPrice: 12,
            maxPrice7d: 15,
          },
          { printing: "Foil", condition: "Near Mint", price: 40 },
        ],
      },
      SYNCED,
      GAME,
    )!;
    expect(out.card).toMatchObject({
      id: `${GAME}-origins-jinx-001`,
      slug: "origins-jinx-001",
      setId: `origins-${GAME}`,
      name: "Jinx",
      number: "1/298",
      numberSort: 1,
      rarity: "Epic",
      tcgplayerId: "653094",
      imageSmallUrl: "https://tcgplayer-cdn.tcgplayer.com/product/653094_in_400x400.jpg",
      imageLargeUrl: "https://tcgplayer-cdn.tcgplayer.com/product/653094_in_1000x1000.jpg",
    });
    const byVariant = Object.fromEntries(out.prices.map((p) => [p.variant, p]));
    // Near Mint wins over Lightly Played for the Normal printing.
    expect(byVariant.normal).toMatchObject({
      source: "tcgplayer",
      currency: "USD",
      normalizedPriceMinor: 1250,
      lowMinor: 1000,
      midMinor: 1200,
      highMinor: 1500,
    });
    expect(byVariant.foil.normalizedPriceMinor).toBe(4000);
  });

  it("accepts `set` as a bare string id and tolerates missing prices", () => {
    const out = normalizeRiftboundCard(
      { id: "c2", name: "Ashe", number: "2", set: "ogn" },
      SYNCED,
    )!;
    expect(out.card.setId).toBe("ogn");
    expect(out.prices).toEqual([]);
  });

  it("returns null without id / name / set", () => {
    expect(normalizeRiftboundCard({ name: "x", number: "1" }, SYNCED)).toBeNull();
  });
});
