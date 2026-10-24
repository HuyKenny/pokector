/**
 * JustTCG → Riftbound DB-row adapter. Field extraction verified live against the
 * owner's JustTCG key (games/sets/cards), mapping into the parallel riftbound_*
 * insert shapes + market-price rows. Reuses the shared slug/money helpers so
 * Riftbound URLs and prices behave exactly like the Pokémon side.
 *
 * Live shape notes (JustTCG, confirmed 2026-07-23):
 * - Sets:  { id, name, game_id, release_date (ISO), cards_count, … } — no `code`, no logo.
 * - Cards: { id, name, set (string id), set_name, number ("255/298"), rarity,
 *            tcgplayerId, variants[] } — no image URL (built from tcgplayerId).
 * - Variants: { printing ("Normal"/"Foil"), condition ("Near Mint"/…), price,
 *            avgPrice, minPrice7d, maxPrice7d, priceHistory[], … } — no currency
 *            field (TCGplayer aggregate ⇒ USD). Ids are already clean slugs, and
 *            carry the game-id as a prefix (cards) / suffix (sets); stripping it
 *            yields short, unique, human URLs.
 */
import type { JustTcgRow } from "../justtcg/client.server";
import type { schema } from "../db/index.server";
import type { PriceSource } from "../market/market";
import { toMinorUnits } from "../money/decimal";
import { normalizeName, numberSortKey, slugify } from "../seo/slug";

export type RiftboundSetInsert = typeof schema.riftboundSets.$inferInsert;
export type RiftboundCardInsert = typeof schema.riftboundCards.$inferInsert;

export interface RiftboundPriceRow {
  source: PriceSource;
  variant: string;
  currency: "USD" | "EUR";
  normalizedPriceMinor: number;
  lowMinor: number | null;
  midMinor: number | null;
  highMinor: number | null;
  marketMinor: number | null;
  sourceUpdatedAt: string | null;
}

export interface NormalizedRiftboundCard {
  card: RiftboundCardInsert;
  prices: RiftboundPriceRow[];
}

const NEAR_MINT = /near\s*mint|^nm\b/i;

// ── loose-field helpers ──────────────────────────────────────────────────────

function str(obj: JustTcgRow, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

function num(obj: JustTcgRow, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

/** JustTCG ids embed the game id (card ids as a prefix, set ids as a suffix).
 * Stripping it turns the verbose id into a short, stable, unique slug. */
function stripGameId(id: string, gameId?: string): string {
  if (!gameId) return id;
  const g = gameId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return id.replace(new RegExp(`^${g}-`), "").replace(new RegExp(`-${g}$`), "");
}

/** TCGplayer product image (JustTCG doesn't return image URLs). Hotlinkable;
 * a handful of promo/sealed products 404 → the UI shows a "No image" tile. */
function tcgplayerImage(tcgId: string | null, size: "small" | "large"): string | null {
  if (!tcgId) return null;
  const dim = size === "large" ? "1000x1000" : "400x400";
  return `https://tcgplayer-cdn.tcgplayer.com/product/${tcgId}_in_${dim}.jpg`;
}

function imageOf(raw: JustTcgRow, size: "small" | "large"): string | null {
  const images = raw.images;
  if (images && typeof images === "object") {
    const got = str(images as JustTcgRow, size, size === "large" ? "small" : "large");
    if (got) return got;
  }
  return str(raw, "imageUrl", "image", "imageLarge", "imageSmall");
}

/** Resolve a set id from a card's `set` (string id, or object with id/code). */
function setIdOf(raw: JustTcgRow): string | null {
  const direct = str(raw, "setId", "set_id");
  if (direct) return direct;
  const set = raw.set;
  if (typeof set === "string" && set.trim()) return set.trim();
  if (set && typeof set === "object") {
    return str(set as JustTcgRow, "id", "setId", "code");
  }
  return null;
}

/** Resolve the Riftbound game id/slug from GET /games (name/slug/id match). */
export function resolveRiftboundGameId(games: JustTcgRow[]): string | null {
  const rx = /riftbound|league of legends|\blol\b/i;
  for (const g of games) {
    const id = str(g, "id", "slug", "gameId", "game");
    const name = str(g, "name", "displayName") ?? "";
    if (id && (rx.test(id) || rx.test(name))) return id;
  }
  return null;
}

// ── normalizers ──────────────────────────────────────────────────────────────

export function normalizeRiftboundSet(
  raw: JustTcgRow,
  syncedAt: Date,
  gameId?: string,
): RiftboundSetInsert | null {
  const id = str(raw, "id", "setId", "code");
  const name = str(raw, "name", "displayName");
  if (!id || !name) return null;
  const releaseDate = str(raw, "releaseDate", "released_at", "release_date");
  return {
    id,
    slug: slugify(stripGameId(id, gameId)) || slugify(name),
    name,
    code: str(raw, "code", "abbreviation"),
    releaseDate: releaseDate ? releaseDate.slice(0, 10) : null,
    imageUrl: str(raw, "imageUrl", "logo", "image") ?? imageOf(raw, "large"),
    syncedAt,
    active: true,
  };
}

export function normalizeRiftboundCard(
  raw: JustTcgRow,
  syncedAt: Date,
  gameId?: string,
): NormalizedRiftboundCard | null {
  const id = str(raw, "id", "cardId");
  const name = str(raw, "name");
  const number = str(raw, "number", "collectorNumber", "num") ?? "";
  const setId = setIdOf(raw);
  if (!id || !name || !setId) return null;

  const rarity = str(raw, "rarity");
  const tcgId = str(raw, "tcgplayerId", "tcgplayer_id");
  const setName = str(raw, "setName", "set_name");
  const card: RiftboundCardInsert = {
    id,
    // Card ids are unique, clean slugs once the game-id prefix is stripped → use
    // them directly so the `slug` UNIQUE constraint can never collide (matters
    // for promo/sealed rows whose `number` is "N/A").
    slug: slugify(stripGameId(id, gameId)),
    setId,
    name,
    nameNormalized: normalizeName(name),
    number: number || "—",
    numberSort: numberSortKey(number),
    rarity,
    imageSmallUrl: imageOf(raw, "small") ?? tcgplayerImage(tcgId, "small"),
    imageLargeUrl: imageOf(raw, "large") ?? tcgplayerImage(tcgId, "large"),
    tcgplayerId: tcgId,
    searchText: [name, setName, number, rarity].filter(Boolean).join(" ").toLowerCase(),
    sourceUpdatedAt: str(raw, "lastUpdated", "updatedAt"),
    syncedAt,
    active: true,
  };

  // One price row per printing (Normal/Foil/…). JustTCG lists a variant per
  // (printing × condition); we keep the Near Mint condition as the market price
  // (the catalog convention), else the first seen. source="tcgplayer", USD.
  const chosen = new Map<string, JustTcgRow>();
  const variants = Array.isArray(raw.variants) ? (raw.variants as JustTcgRow[]) : [];
  for (const v of variants) {
    const printing = slugify(str(v, "printing", "variant") ?? "normal") || "normal";
    const prev = chosen.get(printing);
    if (!prev) {
      chosen.set(printing, v);
      continue;
    }
    if (
      NEAR_MINT.test(str(v, "condition") ?? "") &&
      !NEAR_MINT.test(str(prev, "condition") ?? "")
    ) {
      chosen.set(printing, v);
    }
  }

  const prices: RiftboundPriceRow[] = [];
  for (const [printing, v] of chosen) {
    const minor = toMinorUnits(num(v, "price", "marketPrice", "avgPrice"));
    if (minor === null) continue;
    prices.push({
      source: "tcgplayer",
      variant: printing,
      currency: "USD",
      normalizedPriceMinor: minor,
      lowMinor: toMinorUnits(num(v, "minPrice7d", "minPrice30d", "low", "lowPrice")),
      midMinor: toMinorUnits(num(v, "avgPrice", "avgPrice7d", "mid", "midPrice")),
      highMinor: toMinorUnits(num(v, "maxPrice7d", "maxPrice30d", "high", "highPrice")),
      marketMinor: minor,
      sourceUpdatedAt: str(v, "lastUpdated", "updatedAt"),
    });
  }

  return { card, prices };
}
