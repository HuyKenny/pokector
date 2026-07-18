/**
 * Generation → region metadata for the Pokédex filter (labels like "Kanto (I)").
 * Region names are proper nouns, kept as-is across locales (like Pokémon names).
 * Hand-maintained (separate from the generated species.ts).
 */
export const GENERATIONS = [
  { gen: 1, region: "Kanto", roman: "I" },
  { gen: 2, region: "Johto", roman: "II" },
  { gen: 3, region: "Hoenn", roman: "III" },
  { gen: 4, region: "Sinnoh", roman: "IV" },
  { gen: 5, region: "Unova", roman: "V" },
  { gen: 6, region: "Kalos", roman: "VI" },
  { gen: 7, region: "Alola", roman: "VII" },
  { gen: 8, region: "Galar", roman: "VIII" },
  { gen: 9, region: "Paldea", roman: "IX" },
] as const;

/** "Kanto (I)" label for a generation number. */
export function generationLabel(gen: number): string {
  const g = GENERATIONS.find((x) => x.gen === gen);
  return g ? `${g.region} (${g.roman})` : `Gen ${gen}`;
}
