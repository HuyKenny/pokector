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
