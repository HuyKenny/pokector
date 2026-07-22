import { describe, expect, it } from "vitest";

import {
  normalizeRiftboundCard,
  normalizeRiftboundSet,
  resolveRiftboundGameId,
} from "~/lib/riftbound/normalize";

const SYNCED = new Date("2026-07-22T00:00:00Z");

describe("resolveRiftboundGameId", () => {
  it("matches Riftbound by id or name (case-insensitive)", () => {
    expect(
      resolveRiftboundGameId([
        { id: "pokemon", name: "Pokémon" },
        { id: "riftbound", name: "Riftbound (League of Legends TCG)" },
      ]),
    ).toBe("riftbound");
    expect(
      resolveRiftboundGameId([{ id: "lol-tcg", name: "League of Legends TCG" }]),
    ).toBe("lol-tcg");
  });
  it("returns null when no game matches", () => {
    expect(resolveRiftboundGameId([{ id: "mtg", name: "Magic" }])).toBeNull();
  });
});

describe("normalizeRiftboundSet", () => {
  it("maps id/name/code/date and builds a slug", () => {
    const set = normalizeRiftboundSet(
      { id: "ogn", name: "Origins", code: "OGN", releaseDate: "2025-06-01", imageUrl: "https://x/logo.png" },
      SYNCED,
    )!;
    expect(set).toMatchObject({
      id: "ogn",
      slug: "origins-ogn",
      name: "Origins",
      code: "OGN",
      releaseDate: "2025-06-01",
      imageUrl: "https://x/logo.png",
      active: true,
    });
  });
  it("returns null without id or name", () => {
    expect(normalizeRiftboundSet({ name: "No id" }, SYNCED)).toBeNull();
  });
});

describe("normalizeRiftboundCard", () => {
  it("maps a card + its variant prices (USD minor units)", () => {
    const out = normalizeRiftboundCard(
      {
        id: "rb-ogn-001",
        name: "Jinx",
        number: "1",
        rarity: "Epic",
        set: { id: "ogn", name: "Origins" },
        images: { small: "https://x/s.png", large: "https://x/l.png" },
        variants: [
          { printing: "Normal", condition: "Near Mint", price: 12.5, currency: "USD" },
          { printing: "Foil", price: 40, currency: "USD" },
        ],
      },
      SYNCED,
    )!;
    expect(out.card).toMatchObject({
      id: "rb-ogn-001",
      slug: "ogn-1-jinx",
      setId: "ogn",
      name: "Jinx",
      number: "1",
      numberSort: 1,
      rarity: "Epic",
      imageSmallUrl: "https://x/s.png",
      imageLargeUrl: "https://x/l.png",
    });
    const byVariant = Object.fromEntries(out.prices.map((p) => [p.variant, p]));
    expect(byVariant.normal).toMatchObject({
      source: "tcgplayer",
      currency: "USD",
      normalizedPriceMinor: 1250,
    });
    expect(byVariant.foil.normalizedPriceMinor).toBe(4000);
  });

  it("accepts `set` as a bare string id and tolerates missing prices", () => {
    const out = normalizeRiftboundCard({ id: "c2", name: "Ashe", number: "2", set: "ogn" }, SYNCED)!;
    expect(out.card.setId).toBe("ogn");
    expect(out.prices).toEqual([]);
  });

  it("returns null without id / name / set", () => {
    expect(normalizeRiftboundCard({ name: "x", number: "1" }, SYNCED)).toBeNull();
  });
});
