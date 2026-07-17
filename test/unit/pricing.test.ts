import { describe, expect, it } from "vitest";

import base1 from "../fixtures/ptcg/cards-base1.json";
import { normalizeCard } from "~/lib/catalog/normalize";
import {
  mapTcgplayerVariant,
  normalizeCardmarketPrices,
  normalizeSourceDate,
  normalizeTcgplayerPrices,
} from "~/lib/pricing/normalize";
import { PtcgCardmarketSchema, PtcgTcgplayerSchema } from "~/lib/ptcg/types";

const charizardRaw = base1.data.find((c) => c.id === "base1-4");
// Validate the fixture through the same schemas the sync uses.
const charizardTcgplayer = PtcgTcgplayerSchema.parse(charizardRaw?.tcgplayer);
const charizardCardmarket = PtcgCardmarketSchema.parse(charizardRaw?.cardmarket);

describe("variant mapping", () => {
  it("maps documented source keys", () => {
    expect(mapTcgplayerVariant("normal")).toBe("normal");
    expect(mapTcgplayerVariant("holofoil")).toBe("holofoil");
    expect(mapTcgplayerVariant("reverseHolofoil")).toBe("reverseHolofoil");
    expect(mapTcgplayerVariant("1stEditionNormal")).toBe("firstEditionNormal");
    expect(mapTcgplayerVariant("1stEditionHolofoil")).toBe("firstEditionHolofoil");
  });

  it("returns null for unknown keys (no evidence → no variant)", () => {
    expect(mapTcgplayerVariant("unlimited")).toBeNull();
    expect(mapTcgplayerVariant("")).toBeNull();
  });
});

describe("TCGplayer price selection (real fixture)", () => {
  it("selects market first and stores all bands", () => {
    const rows = normalizeTcgplayerPrices(charizardTcgplayer);
    const holo = rows.find((r) => r.variant === "holofoil");
    expect(holo).toBeDefined();
    // Fixture: market 773.51, mid 719.99, low 510
    expect(holo?.normalizedPriceMinor).toBe(77351);
    expect(holo?.marketMinor).toBe(77351);
    expect(holo?.midMinor).toBe(71999);
    expect(holo?.lowMinor).toBe(51000);
    expect(holo?.currency).toBe("USD");
    expect(holo?.sourceUpdatedAt).toBe("2026-07-16");
  });

  it("falls back market → mid → low", () => {
    const rows = normalizeTcgplayerPrices({
      updatedAt: "2026/07/16",
      prices: {
        normal: { market: null, mid: 5.5, low: 4 },
        holofoil: { market: null, mid: null, low: 4.25 },
        reverseHolofoil: { market: null, mid: null, low: null },
      },
    });
    expect(rows.find((r) => r.variant === "normal")?.normalizedPriceMinor).toBe(550);
    expect(rows.find((r) => r.variant === "holofoil")?.normalizedPriceMinor).toBe(425);
    // No usable value → no row at all (never a silent zero).
    expect(rows.find((r) => r.variant === "reverseHolofoil")).toBeUndefined();
  });

  it("returns nothing for a card without prices", () => {
    expect(normalizeTcgplayerPrices(null)).toEqual([]);
    expect(normalizeTcgplayerPrices({ prices: null })).toEqual([]);
  });
});

describe("Cardmarket price selection (real fixture)", () => {
  it("selects trend first, stays in EUR, attaches to known variants", () => {
    const rows = normalizeCardmarketPrices(charizardCardmarket, ["holofoil"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].currency).toBe("EUR");
    // Fixture: trendPrice 4184.6
    expect(rows[0].normalizedPriceMinor).toBe(418460);
    expect(rows[0].variant).toBe("holofoil");
  });

  it("falls back trend → averageSell → low", () => {
    const rows = normalizeCardmarketPrices(
      {
        updatedAt: "2026/07/01",
        prices: { trendPrice: null, averageSellPrice: 12.34, lowPrice: 9 },
      },
      [],
    );
    expect(rows[0]?.normalizedPriceMinor).toBe(1234);
    expect(rows[0]?.variant).toBe("normal"); // fallback variant when none known
  });
});

describe("normalizeCard (real fixture)", () => {
  it("produces a complete DB row with slug and search text", () => {
    const normalized = normalizeCard(charizardRaw, new Date());
    expect(normalized).not.toBeNull();
    expect(normalized?.card.id).toBe("base1-4");
    expect(normalized?.card.slug).toBe("base1-4-charizard");
    expect(normalized?.card.setId).toBe("base1");
    expect(normalized?.card.numberSort).toBe(4);
    expect(normalized?.card.searchText).toContain("charizard");
    expect(normalized?.prices.length).toBeGreaterThan(0);
  });

  it("skips malformed records instead of throwing", () => {
    expect(normalizeCard({ garbage: true }, new Date())).toBeNull();
    expect(normalizeCard(null, new Date())).toBeNull();
  });
});

describe("normalizeSourceDate", () => {
  it("converts slashes to ISO dashes", () => {
    expect(normalizeSourceDate("2026/07/16")).toBe("2026-07-16");
    expect(normalizeSourceDate("2026-07-16")).toBe("2026-07-16");
    expect(normalizeSourceDate(null)).toBeNull();
  });
});
