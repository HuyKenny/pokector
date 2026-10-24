/**
 * Pure matching logic for the TCGCSV price source (TCGplayer data, see
 * docs/DECISIONS.md D29). Two steps, both conservative — an unmatched card stays
 * unpriced rather than borrowing a neighbour's price (SPEC §10):
 *
 *   1. Pokémon TCG API set → TCGplayer group(s): exact normalized name, with a
 *      reviewed override table for sets TCGplayer names differently (promos,
 *      McDonald's, base sets) or splits into extra groups (Radiant Collections).
 *   2. Card → TCGplayer product: by card number inside the mapped group(s). When a
 *      number is shared (pattern/stamped/staff variants), the name decides, then
 *      the one product without a qualifier, then the one that is not a [Staff]
 *      print; anything still ambiguous is skipped.
 *
 * Verified offline on 2026-10-24 against the full catalog: 98.8 % of 20,621
 * active cards match, and every name difference among the matches was a spelling
 * variant (♀ → F, ★ → Star, ◇ → Prism Star), not a different card.
 */

import { toMinorUnits } from "../money/decimal";
import type { CardVariant, NormalizedPriceRow } from "../pricing/normalize";

export interface TcgcsvGroup {
  groupId: number;
  name: string;
  abbreviation?: string | null;
  publishedOn?: string | null;
}

export interface TcgcsvProduct {
  productId: number;
  name: string;
  extendedData?: { name: string; value: string }[];
}

export interface TcgcsvPrice {
  productId: number;
  lowPrice: number | null;
  midPrice: number | null;
  highPrice: number | null;
  marketPrice: number | null;
  directLowPrice: number | null;
  subTypeName: string;
}

/** Sets whose TCGplayer group name differs from the Pokémon TCG API name, or
 * whose cards TCGplayer spreads over more than one group. Reviewed 2026-10-24.
 * The EX Trainer Kits (tk1a/tk1b, tk2a/tk2b) are left out on purpose: both
 * halves share one TCGplayer group and the same card numbers. */
export const SET_GROUP_OVERRIDES: Record<string, number[]> = {
  basep: [1418], // WoTC Promo
  bp: [1455], // Best of Promos
  np: [1423], // Nintendo Promos
  dpp: [1421], // Diamond and Pearl Promos
  hsp: [1453], // HGSS Promos
  bwp: [1407], // Black and White Promos
  xyp: [1451], // XY Promos
  smp: [1861], // SM Promos
  swshp: [2545], // SWSH: Sword & Shield Promo Cards
  svp: [22872], // SV: Scarlet & Violet Promo Cards
  base1: [604], // Base Set
  ecard1: [1375], // Expedition
  ex1: [1393], // EX Ruby and Sapphire
  ex2: [1392], // EX Sandstorm
  ex3: [1376], // EX Dragon
  ex4: [1377], // EX Team Magma vs Team Aqua
  ex5: [1416], // EX Hidden Legends
  ex6: [1419], // EX FireRed & LeafGreen
  ex7: [1428], // EX Team Rocket Returns
  ex8: [1404], // EX Deoxys
  ex9: [1410], // EX Emerald
  ex10: [1398], // EX Unseen Forces
  ex11: [1429], // EX Delta Species
  ex12: [1378], // EX Legend Maker
  ex13: [1379], // EX Holon Phantoms
  ex14: [1395], // EX Crystal Guardians
  ex15: [1411], // EX Dragon Frontiers
  ex16: [1383], // EX Power Keepers
  hgss1: [1402], // HeartGold SoulSilver
  hgss2: [1399], // Unleashed
  hgss3: [1403], // Undaunted
  hgss4: [1381], // Triumphant
  xy1: [1387], // XY Base Set
  sv1: [22873], // SV01: Scarlet & Violet Base Set
  sv3pt5: [23237], // SV: Scarlet & Violet 151
  ru1: [1433], // Rumble
  sm1: [1863], // SM Base Set
  swsh1: [2585], // SWSH01: Sword & Shield Base Set
  bw11: [1409, 1465], // Legendary Treasures + its Radiant Collection (RC1–RC25)
  g1: [1728, 1729], // Generations + its Radiant Collection (RC1–RC32)
  mcd11: [1401],
  mcd12: [1427],
  mcd14: [1692],
  mcd15: [1694],
  mcd16: [3087],
  mcd17: [2148],
  mcd18: [2364],
  mcd19: [2555],
  mcd21: [2782], // McDonald's 25th Anniversary Promos
  mcd22: [3150],
};

/** Lower-case ASCII words: "Pokémon GO" → "pokemon go", "&" → "and". */
export function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** TCGplayer group names carry a series code prefix: "ME05: Pitch Black",
 * "SWSH09: Brilliant Stars Trainer Gallery", "SV: Scarlet & Violet 151". */
function groupNameWithoutPrefix(name: string): string {
  return name.replace(/^[A-Za-z]{1,5}\d{0,3}[a-z]?\s*[:-]\s+/, "");
}

/** Map every set to its TCGplayer group ids. Unmapped sets are simply absent. */
export function matchSetsToGroups(
  sets: { id: string; name: string }[],
  groups: TcgcsvGroup[],
  overrides: Record<string, number[]> = SET_GROUP_OVERRIDES,
): Map<string, number[]> {
  const byName = new Map<string, TcgcsvGroup[]>();
  for (const group of groups) {
    const keys = new Set([
      normalizeName(group.name),
      normalizeName(groupNameWithoutPrefix(group.name)),
    ]);
    for (const key of keys) {
      const list = byName.get(key) ?? [];
      list.push(group);
      byName.set(key, list);
    }
  }
  const known = new Set(groups.map((g) => g.groupId));
  const result = new Map<string, number[]>();
  for (const set of sets) {
    const override = overrides[set.id];
    if (override) {
      const present = override.filter((id) => known.has(id));
      if (present.length > 0) result.set(set.id, present);
      continue;
    }
    const candidates = byName.get(normalizeName(set.name)) ?? [];
    if (candidates.length === 1) result.set(set.id, [candidates[0].groupId]);
  }
  return result;
}

/** "001/084" → "1", "TG01/TG30" → "TG1", "SWSH001" → "SWSH1", "25a" → "25A". */
export function normalizeCardNumber(value: string): string {
  return value
    .split("/")[0]
    .trim()
    .toUpperCase()
    .replace(/(?<!\d)0+(?=\d)/g, "");
}

const QUALIFIER = /\s*(\([^)]*\)|\[[^\]]*\])/g;

/** Product name without the number suffix and qualifiers, as a comparison key:
 * "Pikachu - SM04 (Target Non-Holo)" → "pikachu". */
function productBaseKey(name: string): string {
  return nameKey(name.split(" - ")[0].replace(QUALIFIER, ""));
}

function nameKey(name: string): string {
  return normalizeName(name).replace(/ /g, "");
}

function hasQualifier(name: string): boolean {
  return /\(|\[/.test(name.split(" - ")[0]);
}

/** Choose the one product a card corresponds to, or null when unsure. */
export function pickProduct(candidates: TcgcsvProduct[], cardName: string): TcgcsvProduct | null {
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) return null;
  const key = nameKey(cardName);
  const named = candidates.filter((p) => productBaseKey(p.name) === key);
  const pool = named.length > 0 ? named : candidates;
  if (pool.length === 1) return pool[0];
  const plain = pool.filter((p) => !hasQualifier(p.name));
  if (plain.length === 1) return plain[0];
  const notStaff = pool.filter((p) => !p.name.includes("[Staff]"));
  if (notStaff.length === 1) return notStaff[0];
  return null;
}

function productNumber(product: TcgcsvProduct): string | null {
  const field = product.extendedData?.find((e) => e.name === "Number");
  return field?.value ? normalizeCardNumber(field.value) : null;
}

/** Card id → TCGplayer product id for one set. Cards without a confident match
 * are left out. */
export function matchCardsToProducts(
  cards: { id: string; number: string; name: string }[],
  products: TcgcsvProduct[],
): Record<string, number> {
  const byNumber = new Map<string, TcgcsvProduct[]>();
  for (const product of products) {
    const number = productNumber(product);
    if (!number) continue; // sealed product, code card, etc.
    const list = byNumber.get(number) ?? [];
    list.push(product);
    byNumber.set(number, list);
  }
  const result: Record<string, number> = {};
  for (const card of cards) {
    const product = pickProduct(byNumber.get(normalizeCardNumber(card.number)) ?? [], card.name);
    if (product) result[card.id] = product.productId;
  }
  return result;
}

/** TCGplayer printing → Pokector variant. "Unlimited" is TCGplayer's name for
 * the regular print of the WotC-era sets that also had a 1st Edition run. */
const SUBTYPE_VARIANT_MAP: Record<string, CardVariant> = {
  Normal: "normal",
  Holofoil: "holofoil",
  "Reverse Holofoil": "reverseHolofoil",
  "1st Edition": "firstEditionNormal",
  "1st Edition Normal": "firstEditionNormal",
  "1st Edition Holofoil": "firstEditionHolofoil",
  Unlimited: "normal",
  "Unlimited Holofoil": "holofoil",
};

/** Price rows for the matched cards, in the same shape the PTCG normalizer emits
 * (SPEC §16: market → mid → low). `sourceDate` is the TCGCSV build date. */
export function buildPriceRows(
  cardProducts: Record<string, number>,
  prices: TcgcsvPrice[],
  sourceDate: string,
): { cardId: string; price: NormalizedPriceRow }[] {
  const byProduct = new Map<number, TcgcsvPrice[]>();
  for (const price of prices) {
    const list = byProduct.get(price.productId) ?? [];
    list.push(price);
    byProduct.set(price.productId, list);
  }
  const rows: { cardId: string; price: NormalizedPriceRow }[] = [];
  for (const [cardId, productId] of Object.entries(cardProducts)) {
    const seen = new Set<CardVariant>();
    for (const p of byProduct.get(productId) ?? []) {
      const variant = SUBTYPE_VARIANT_MAP[p.subTypeName];
      if (!variant || seen.has(variant)) continue;
      const market = toMinorUnits(p.marketPrice);
      const mid = toMinorUnits(p.midPrice);
      const low = toMinorUnits(p.lowPrice);
      const normalized = market ?? mid ?? low;
      if (normalized === null) continue;
      seen.add(variant);
      rows.push({
        cardId,
        price: {
          source: "tcgplayer",
          variant,
          currency: "USD",
          normalizedPriceMinor: normalized,
          lowMinor: low,
          midMinor: mid,
          highMinor: toMinorUnits(p.highPrice),
          marketMinor: market,
          directLowMinor: toMinorUnits(p.directLowPrice),
          trendMinor: null,
          averageSellMinor: null,
          sourceUpdatedAt: sourceDate,
        },
      });
    }
  }
  return rows;
}
