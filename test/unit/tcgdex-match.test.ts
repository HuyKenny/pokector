import { describe, expect, it } from "vitest";

import { cardIdsByNumber, cardmarketRows, matchSetsToTcgdex } from "~/lib/tcgdex/match";

describe("matchSetsToTcgdex", () => {
  const tcgdex = [
    { id: "base1", name: "Base Set" },
    { id: "sv01", name: "Scarlet & Violet" },
    { id: "swsh10.5", name: "Pokémon GO" },
    { id: "a", name: "Twin" },
    { id: "b", name: "Twin" },
  ];

  it("matches by equal id, then by unique normalized name", () => {
    expect(
      matchSetsToTcgdex(
        [
          { id: "base1", name: "Base Set" },
          { id: "sv1", name: "Scarlet & Violet" },
          { id: "pgo", name: "Pokémon GO" },
          { id: "tw", name: "Twin" },
          { id: "zz", name: "Unknown" },
        ],
        tcgdex,
      ),
    ).toEqual({ base1: "base1", sv1: "sv01", pgo: "swsh10.5" });
  });
});

describe("cardIdsByNumber", () => {
  it("normalizes padded numbers and drops duplicates", () => {
    expect(
      cardIdsByNumber([
        { id: "sv01-001", localId: "001" },
        { id: "sv01-GG01", localId: "GG01" },
        { id: "x-1", localId: "7" },
        { id: "x-2", localId: "007" },
      ]),
    ).toEqual({ "1": "sv01-001", GG1: "sv01-GG01" });
  });
});

describe("cardmarketRows", () => {
  it("uses trend → avg → low per known variant, dated by the feed", () => {
    const rows = cardmarketRows(
      { updated: "2026-10-23T19:57:35.249Z", trend: null, avg: 1.5, low: 0.2 },
      ["normal", "reverseHolofoil"],
    );
    expect(rows.map((r) => [r.variant, r.normalizedPriceMinor, r.sourceUpdatedAt])).toEqual([
      ["normal", 150, "2026-10-23"],
      ["reverseHolofoil", 150, "2026-10-23"],
    ]);
    expect(cardmarketRows({ updated: null }, ["normal"])).toEqual([]);
    expect(cardmarketRows(null, [])).toEqual([]);
  });
});
