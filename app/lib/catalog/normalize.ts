/**
 * Catalog normalization: raw PTCG API records → database rows. Malformed records
 * are skipped individually (SPEC §15) — the caller counts them and continues.
 */

import type { schema } from "../db/index.server";
import {
  normalizeCardmarketPrices,
  normalizeSourceDate,
  normalizeTcgplayerPrices,
  type NormalizedPriceRow,
} from "../pricing/normalize";
import { PtcgCardSchema, PtcgSetSchema } from "../ptcg/types";
import { cardSlug, normalizeName, numberSortKey, setSlug, slugify } from "../seo/slug";

type SetInsert = typeof schema.pokemonSets.$inferInsert;
type CardInsert = typeof schema.pokemonCards.$inferInsert;

export function normalizeSet(raw: unknown, syncedAt: Date): SetInsert | null {
  const parsed = PtcgSetSchema.safeParse(raw);
  if (!parsed.success) return null;
  const set = parsed.data;
  return {
    id: set.id,
    // Set names collide across series (e.g. reprints) — suffix the id for uniqueness.
    slug: `${setSlug(set.id, set.name)}-${slugify(set.id)}`,
    name: set.name,
    nameNormalized: normalizeName(set.name),
    series: set.series || "Other",
    printedTotal: set.printedTotal ?? null,
    total: set.total ?? null,
    releaseDate: normalizeSourceDate(set.releaseDate),
    symbolUrl: set.images?.symbol ?? null,
    logoUrl: set.images?.logo ?? null,
    sourceUpdatedAt: normalizeSourceDate(set.updatedAt),
    syncedAt,
    active: true,
  };
}

export interface NormalizedCard {
  card: CardInsert;
  prices: NormalizedPriceRow[];
}

export function normalizeCard(raw: unknown, syncedAt: Date): NormalizedCard | null {
  const parsed = PtcgCardSchema.safeParse(raw);
  if (!parsed.success) return null;
  const card = parsed.data;

  const hp = card.hp ? Number.parseInt(card.hp, 10) : null;
  const tcgplayerPrices = normalizeTcgplayerPrices(card.tcgplayer);
  const knownVariants = tcgplayerPrices.map((p) => p.variant);
  const cardmarketPrices = normalizeCardmarketPrices(card.cardmarket, knownVariants);

  const searchText = [
    card.name,
    card.set.id,
    card.number,
    card.rarity ?? "",
    (card.types ?? []).join(" "),
  ]
    .join(" ")
    .toLowerCase();

  return {
    card: {
      id: card.id,
      slug: cardSlug(card.set.id, card.number, card.name),
      setId: card.set.id,
      name: card.name,
      nameNormalized: normalizeName(card.name),
      number: card.number,
      numberSort: numberSortKey(card.number),
      supertype: card.supertype ?? null,
      subtypesJson: card.subtypes?.length ? JSON.stringify(card.subtypes) : null,
      hp: Number.isFinite(hp) ? hp : null,
      typesJson: card.types?.length ? JSON.stringify(card.types) : null,
      rarity: card.rarity ?? null,
      artist: card.artist ?? null,
      nationalPokedexNumbersJson: card.nationalPokedexNumbers?.length
        ? JSON.stringify(card.nationalPokedexNumbers)
        : null,
      regulationMark: card.regulationMark ?? null,
      imageSmallUrl: card.images?.small ?? null,
      imageLargeUrl: card.images?.large ?? null,
      tcgplayerUrl: card.tcgplayer?.url ?? null,
      cardmarketUrl: card.cardmarket?.url ?? null,
      searchText,
      sourceUpdatedAt: normalizeSourceDate(card.tcgplayer?.updatedAt),
      syncedAt,
      active: true,
    },
    prices: [...tcgplayerPrices, ...cardmarketPrices],
  };
}
