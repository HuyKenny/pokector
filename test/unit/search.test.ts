import { describe, expect, it } from "vitest";

import { buildFtsMatch } from "~/lib/catalog/search.server";

describe("buildFtsMatch", () => {
  it("wraps a single token as a prefix term", () => {
    expect(buildFtsMatch("charizard")).toBe('"charizard"*');
  });

  it("ANDs multiple tokens (all must match)", () => {
    expect(buildFtsMatch("base charizard")).toBe('"base"* "charizard"*');
  });

  it("splits card numbers on the slash and matches numbers exactly", () => {
    expect(buildFtsMatch("charizard 4/102")).toBe('"charizard"* "4" "102"');
  });

  it("strips diacritics and lowercases", () => {
    expect(buildFtsMatch("Pokémon")).toBe('"pokemon"*');
  });

  it("supports a relaxed OR mode for suggestions", () => {
    expect(buildFtsMatch("base charizard", "or")).toBe('"base"* OR "charizard"*');
  });

  it("returns null when there are no usable tokens", () => {
    expect(buildFtsMatch("   ")).toBeNull();
    expect(buildFtsMatch("!!!")).toBeNull();
    expect(buildFtsMatch("")).toBeNull();
  });

  it("caps the number of tokens", () => {
    const many = Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ");
    const match = buildFtsMatch(many);
    expect(match).not.toBeNull();
    expect((match as string).split(" ").length).toBe(12);
  });
});
