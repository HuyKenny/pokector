/**
 * URL slug ↔ species mapping for the per-Pokémon hubs (/pokemon/{name}).
 * Slug = lowercased species name, accents folded, non-alphanumerics → "-".
 * (Kept separate from the generated species.ts so that file stays machine-owned.)
 */
import { SPECIES, type Species } from "./species";

export function speciesSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents (Flabébé → flabebe)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const BY_SLUG = new Map<string, Species>();
for (const s of SPECIES) {
  const slug = speciesSlug(s.name);
  // First species wins on the rare slug collision (e.g. Nidoran forms).
  if (slug && !BY_SLUG.has(slug)) BY_SLUG.set(slug, s);
}

export function speciesBySlug(slug: string): Species | undefined {
  return BY_SLUG.get(slug.toLowerCase());
}

const BY_DEX = new Map<number, Species>(SPECIES.map((s) => [s.dex, s]));

/**
 * Per-Pokémon hub links for a card, from its `national_pokedex_numbers_json`.
 * Tag-team cards list several species, so this can return more than one.
 * Malformed or unknown numbers are dropped.
 */
export function speciesHubsForCard(dexJson: string | null): { name: string; slug: string }[] {
  if (!dexJson) return [];
  let dexes: unknown;
  try {
    dexes = JSON.parse(dexJson);
  } catch {
    return [];
  }
  if (!Array.isArray(dexes)) return [];
  const out: { name: string; slug: string }[] = [];
  for (const d of dexes) {
    const s = typeof d === "number" ? BY_DEX.get(d) : undefined;
    if (s && !out.some((o) => o.name === s.name)) {
      out.push({ name: s.name, slug: speciesSlug(s.name) });
    }
  }
  return out;
}
