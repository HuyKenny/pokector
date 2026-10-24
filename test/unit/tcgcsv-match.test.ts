import { describe, expect, it } from "vitest";

import {
  buildPriceRows,
  matchCardsToProducts,
  matchSetsToGroups,
  normalizeCardNumber,
  pickProduct,
  type TcgcsvPrice,
  type TcgcsvProduct,
} from "~/lib/tcgcsv/match";

const product = (productId: number, name: string, number?: string): TcgcsvProduct => ({
  productId,
  name,
  extendedData: number ? [{ name: "Number", value: number }] : [],
});

const price = (
  productId: number,
  subTypeName: string,
  marketPrice: number | null,
): TcgcsvPrice => ({
  productId,
  subTypeName,
  marketPrice,
  lowPrice: 0.01,
  midPrice: 0.2,
  highPrice: 5,
  directLowPrice: null,
});

describe("normalizeCardNumber", () => {
  it("drops the set total and leading zeros, keeps letter prefixes", () => {
    expect(normalizeCardNumber("001/084")).toBe("1");
    expect(normalizeCardNumber("TG01/TG30")).toBe("TG1");
    expect(normalizeCardNumber("SWSH001")).toBe("SWSH1");
    expect(normalizeCardNumber("RC10/RC32")).toBe("RC10");
    expect(normalizeCardNumber("25a")).toBe("25A");
    expect(normalizeCardNumber("100")).toBe("100");
  });
});

describe("matchSetsToGroups", () => {
  const groups = [
    { groupId: 24688, name: "ME05: Pitch Black" },
    { groupId: 23237, name: "SV: Scarlet & Violet 151" },
    { groupId: 2754, name: "Pokemon GO" },
    { groupId: 1, name: "Duplicate" },
    { groupId: 2, name: "Duplicate" },
    { groupId: 2545, name: "SWSH: Sword & Shield Promo Cards" },
  ];

  it("matches by normalized name with the series prefix stripped", () => {
    const m = matchSetsToGroups(
      [
        { id: "me5", name: "Pitch Black" },
        { id: "sv3pt5", name: "Scarlet & Violet 151" },
        { id: "pgo", name: "Pokémon GO" },
      ],
      groups,
    );
    expect(m.get("me5")).toEqual([24688]);
    expect(m.get("sv3pt5")).toEqual([23237]);
    expect(m.get("pgo")).toEqual([2754]);
  });

  it("skips ambiguous names and uses overrides only for groups that exist", () => {
    const m = matchSetsToGroups(
      [
        { id: "dup", name: "Duplicate" },
        { id: "swshp", name: "SWSH Black Star Promos" },
        { id: "bw11", name: "Legendary Treasures" },
      ],
      groups,
    );
    expect(m.has("dup")).toBe(false);
    expect(m.get("swshp")).toEqual([2545]);
    expect(m.has("bw11")).toBe(false); // override groups absent from this listing
  });
});

describe("pickProduct", () => {
  it("prefers the unqualified print over pattern variants", () => {
    const cands = [
      product(1, "Exeggcute (Poke Ball Pattern)"),
      product(2, "Exeggcute"),
      product(3, "Exeggcute (Master Ball Pattern)"),
    ];
    expect(pickProduct(cands, "Exeggcute")?.productId).toBe(2);
  });

  it("lets the card name decide when different cards share a number", () => {
    const cands = [product(1, "Venusaur"), product(2, "Here Comes Team Rocket!")];
    expect(pickProduct(cands, "Here Comes Team Rocket!")?.productId).toBe(2);
  });

  it("drops [Staff] prints and gives up when still ambiguous", () => {
    expect(
      pickProduct(
        [
          product(1, "Quaquaval - 005 (Prerelease) [Staff]"),
          product(2, "Quaquaval - 005 (Prerelease)"),
        ],
        "Quaquaval",
      )?.productId,
    ).toBe(2);
    expect(
      pickProduct(
        [product(1, "Celebi ex (Non-Holo)"), product(2, "Celebi ex (Holo)")],
        "Celebi ex",
      ),
    ).toBeNull();
  });
});

describe("matchCardsToProducts + buildPriceRows", () => {
  const products = [
    product(704758, "Tropius", "001/084"),
    product(704759, "Tropius (Poke Ball Pattern)", "001/084"),
    product(700001, "Mega Darkrai ex", "120/084"),
    product(900000, "Pitch Black Booster Box"), // sealed: no number
  ];
  const cards = [
    { id: "me5-1", number: "1", name: "Tropius" },
    { id: "me5-120", number: "120", name: "Mega Darkrai ex" },
    { id: "me5-999", number: "999", name: "Missing" },
  ];

  it("maps cards by number and leaves unmatched cards out", () => {
    expect(matchCardsToProducts(cards, products)).toEqual({ "me5-1": 704758, "me5-120": 700001 });
  });

  it("emits one row per known printing in minor units, market → mid → low", () => {
    const rows = buildPriceRows(
      { "me5-1": 704758, "me5-120": 700001 },
      [
        price(704758, "Normal", 0.07),
        price(704758, "Reverse Holofoil", 0.18),
        price(704758, "Some New Printing", 1),
        price(700001, "Holofoil", null), // no market → falls back to mid
        price(704759, "Normal", 9.99), // unmatched product
      ],
      "2026-10-23",
    );
    expect(rows.map((r) => [r.cardId, r.price.variant, r.price.normalizedPriceMinor])).toEqual([
      ["me5-1", "normal", 7],
      ["me5-1", "reverseHolofoil", 18],
      ["me5-120", "holofoil", 20],
    ]);
    expect(rows[0].price).toMatchObject({
      source: "tcgplayer",
      currency: "USD",
      sourceUpdatedAt: "2026-10-23",
      lowMinor: 1,
      highMinor: 500,
    });
  });

  it("maps WotC-era Unlimited / 1st Edition printings", () => {
    const rows = buildPriceRows(
      { "base2-50": 1 },
      [
        price(1, "1st Edition", 11.88),
        price(1, "Unlimited", 1.86),
        price(1, "Unlimited Holofoil", 3),
      ],
      "2026-10-23",
    );
    expect(rows.map((r) => r.price.variant)).toEqual(["firstEditionNormal", "normal", "holofoil"]);
  });
});
