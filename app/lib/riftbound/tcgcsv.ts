/**
 * TCGCSV (TCGplayer category 89) → Riftbound DB rows. Replaces JustTCG as the
 * daily Riftbound source (docs/DECISIONS.md D30): JustTCG's free tier (100
 * requests/day) ran out on 2026-10-16, while TCGCSV needs two requests per set.
 *
 * Existing rows keep their JustTCG-era ids and slugs — cards are matched by
 * TCGplayer product id, which every JustTCG card carried. New cards get an id in
 * the same shape (`{game}-{set}-{name}-{rarity}`) so URLs look alike.
 */
import { toMinorUnits } from "../money/decimal";
import { normalizeName, numberSortKey, slugify } from "../seo/slug";
import type { TcgcsvGroup, TcgcsvPrice, TcgcsvProduct } from "../tcgcsv/match";
import {
  tcgplayerImage,
  type RiftboundCardInsert,
  type RiftboundPriceRow,
  type RiftboundSetInsert,
} from "./normalize";

/** JustTCG's game id, kept as the id prefix/suffix of every Riftbound row. */
export const RIFTBOUND_GAME_ID = "riftbound-league-of-legends-trading-card-game";

function extended(product: TcgcsvProduct, name: string): string | null {
  const value = product.extendedData?.find((e) => e.name === name)?.value?.trim();
  return value ? value : null;
}

/** Set row for a TCGplayer group; the id matches what JustTCG used. */
export function riftboundSetFromGroup(group: TcgcsvGroup, syncedAt: Date): RiftboundSetInsert {
  const slug = slugify(group.name);
  return {
    id: `${slug}-${RIFTBOUND_GAME_ID}`,
    slug,
    name: group.name,
    code: group.abbreviation?.trim() || null,
    releaseDate: group.publishedOn ? group.publishedOn.slice(0, 10) : null,
    imageUrl: null,
    syncedAt,
    active: true,
  };
}

/** Card row for a product that is not in the catalog yet. `taken` holds the ids
 * and slugs already used; a collision gets the product id appended. */
export function riftboundCardFromProduct(
  product: TcgcsvProduct,
  set: { id: string; slug: string; name: string },
  taken: { ids: Set<string>; slugs: Set<string> },
  syncedAt: Date,
): RiftboundCardInsert {
  const number = extended(product, "Number");
  const rarity = extended(product, "Rarity");
  let slug = [set.slug, slugify(product.name), rarity ? slugify(rarity) : ""]
    .filter(Boolean)
    .join("-");
  if (taken.ids.has(`${RIFTBOUND_GAME_ID}-${slug}`) || taken.slugs.has(slug)) {
    slug = `${slug}-${product.productId}`;
  }
  const id = `${RIFTBOUND_GAME_ID}-${slug}`;
  taken.ids.add(id);
  taken.slugs.add(slug);
  const tcgId = String(product.productId);
  return {
    id,
    slug,
    setId: set.id,
    name: product.name,
    nameNormalized: normalizeName(product.name),
    number: number ?? "N/A",
    numberSort: numberSortKey(number ?? ""),
    rarity,
    imageSmallUrl: tcgplayerImage(tcgId, "small"),
    imageLargeUrl: tcgplayerImage(tcgId, "large"),
    tcgplayerId: tcgId,
    searchText: [product.name, set.name, number, rarity].filter(Boolean).join(" ").toLowerCase(),
    sourceUpdatedAt: null,
    syncedAt,
    active: true,
  };
}

/** Price rows per product, one per printing ("Normal" → normal, "Foil" → foil,
 * as JustTCG named them), market → mid → low. `sourceDate` is the build date. */
export function riftboundPriceRows(
  prices: TcgcsvPrice[],
  sourceDate: string,
): Map<number, RiftboundPriceRow[]> {
  const byProduct = new Map<number, RiftboundPriceRow[]>();
  for (const p of prices) {
    const variant = slugify(p.subTypeName) || "normal";
    const market = toMinorUnits(p.marketPrice);
    const mid = toMinorUnits(p.midPrice);
    const low = toMinorUnits(p.lowPrice);
    const normalized = market ?? mid ?? low;
    if (normalized === null) continue;
    const rows = byProduct.get(p.productId) ?? [];
    if (rows.some((r) => r.variant === variant)) continue;
    rows.push({
      source: "tcgplayer",
      variant,
      currency: "USD",
      normalizedPriceMinor: normalized,
      lowMinor: low,
      midMinor: mid,
      highMinor: toMinorUnits(p.highPrice),
      marketMinor: market,
      sourceUpdatedAt: sourceDate,
    });
    byProduct.set(p.productId, rows);
  }
  return byProduct;
}
