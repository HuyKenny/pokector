import { describe, expect, it } from "vitest";

import { cardSlug, normalizeName, numberSortKey, setSlug, slugify } from "~/lib/seo/slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Base Set")).toBe("base-set");
  });

  it("strips apostrophes and periods", () => {
    expect(slugify("Blaine's Charizard")).toBe("blaines-charizard");
    expect(slugify("Mr. Mime")).toBe("mr-mime");
  });

  it("maps gender symbols to suffixes", () => {
    expect(slugify("Nidoran ♀")).toBe("nidoran-f");
    expect(slugify("Nidoran ♂")).toBe("nidoran-m");
  });

  it("handles diacritics (Pokémon → pokemon)", () => {
    expect(slugify("Pokémon Center")).toBe("pokemon-center");
  });

  it("expands ampersand", () => {
    expect(slugify("Sun & Moon")).toBe("sun-and-moon");
  });

  it("never produces leading/trailing/double hyphens", () => {
    expect(slugify("  --Weird   Input!!  ")).toBe("weird-input");
  });
});

describe("cardSlug / setSlug", () => {
  it("builds set-number-name card slugs", () => {
    expect(cardSlug("base1", "4", "Charizard")).toBe("base1-4-charizard");
    expect(cardSlug("swsh12pt5gg", "GG44", "Zacian V")).toBe("swsh12pt5gg-gg44-zacian-v");
  });

  it("falls back to set id when name slugifies to nothing", () => {
    expect(setSlug("xy0", "!!!")).toBe("xy0");
    expect(setSlug("base1", "Base")).toBe("base");
  });
});

describe("normalizeName", () => {
  it("strips diacritics and lowercases", () => {
    expect(normalizeName("Pokémon")).toBe("pokemon");
    expect(normalizeName("  FARFETCH'D ")).toBe("farfetch'd");
  });
});

describe("numberSortKey", () => {
  it("extracts numeric prefix", () => {
    expect(numberSortKey("4")).toBe(4);
    expect(numberSortKey("25a")).toBe(25);
    expect(numberSortKey("SWSH001")).toBe(1);
    expect(numberSortKey("GG44")).toBe(44);
  });

  it("returns 0 for non-numeric numbers", () => {
    expect(numberSortKey("XY")).toBe(0);
  });
});

describe("cardSlug with punctuation-only numbers", () => {
  it("spells out ? and ! so Unseen Forces' two Unown don't collide", () => {
    expect(cardSlug("ex10", "?", "Unown")).toBe("ex10-question-unown");
    expect(cardSlug("ex10", "!", "Unown")).toBe("ex10-exclamation-unown");
  });

  it("never emits an empty number segment", () => {
    expect(cardSlug("x", "#", "Foo")).not.toContain("--");
  });

  it("leaves ordinary numbers unchanged", () => {
    expect(cardSlug("ex10", "A", "Unown")).toBe("ex10-a-unown");
    expect(cardSlug("sv3pt5", "199", "Charizard ex")).toBe("sv3pt5-199-charizard-ex");
  });
});
