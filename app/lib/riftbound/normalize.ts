/**
 * JustTCG → Riftbound DB-row adapter. Defensive field extraction (JustTCG's
 * exact field names are confirmed live on staging), mapping into the parallel
 * riftbound_* insert shapes + market-price rows. Reuses the shared slug/money
 * helpers so Riftbound URLs and prices behave exactly like the Pokémon side.
 */
import type { JustTcgRow } from "../justtcg/client.server";
import type { schema } from "../db/index.server";
import type { PriceSource } from "../market/market";
import { toMinorUnits } from "../money/decimal";
import { cardSlug, normalizeName, numberSortKey, setSlug, slugify } from "../seo/slug";

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

// ── loose-field helpers ──────────────────────────────────────────────────────

function str(obj: JustTcgRow, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
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

function imageOf(raw: JustTcgRow, size: "small" | "large"): string | null {
  const images = raw.images;
  if (images && typeof images === "object") {
    const got = str(images as JustTcgRow, size, size === "large" ? "small" : "large");
    if (got) return got;
  }
  return str(raw, "imageUrl", "image", "imageLarge", "imageSmall");
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

export function normalizeRiftboundSet(raw: JustTcgRow, syncedAt: Date): RiftboundSetInsert | null {
  const id = str(raw, "id", "setId", "code");
  const name = str(raw, "name", "displayName");
  if (!id || !name) return null;
  return {
    id,
    slug: `${setSlug(id, name)}-${slugify(id)}`,
    name,
    code: str(raw, "code", "abbreviation"),
    releaseDate: str(raw, "releaseDate", "released_at", "release_date"),
    imageUrl: str(raw, "imageUrl", "logo", "image") ?? imageOf(raw, "large"),
    syncedAt,
    active: true,
  };
}

export function normalizeRiftboundCard(
  raw: JustTcgRow,
  syncedAt: Date,
): NormalizedRiftboundCard | null {
  const id = str(raw, "id", "cardId");
  const name = str(raw, "name");
  const number = str(raw, "number", "collectorNumber", "num") ?? "";
  const setId = setIdOf(raw);
  if (!id || !name || !setId) return null;

  const rarity = str(raw, "rarity");
  const card: RiftboundCardInsert = {
    id,
    slug: cardSlug(setId, number || id, name),
    setId,
    name,
    nameNormalized: normalizeName(name),
    number: number || "—",
    numberSort: numberSortKey(number),
    rarity,
    imageSmallUrl: imageOf(raw, "small"),
    imageLargeUrl: imageOf(raw, "large"),
    tcgplayerId: str(raw, "tcgplayerId", "tcgplayer_id"),
    searchText: [name, str(raw, "setName"), number, rarity].filter(Boolean).join(" ").toLowerCase(),
    sourceUpdatedAt: str(raw, "lastUpdated", "updatedAt"),
    syncedAt,
    active: true,
  };

  // Prices: one row per unique (source, variant, currency). JustTCG aggregates
  // TCGplayer, so source="tcgplayer"; currency defaults to USD.
  const byKey = new Map<string, RiftboundPriceRow>();
  const variants = Array.isArray(raw.variants) ? (raw.variants as JustTcgRow[]) : [];
  for (const v of variants) {
    const minor = toMinorUnits(
      (typeof v.price === "number" || typeof v.price === "string" ? v.price : null) ??
        str(v, "price", "marketPrice"),
    );
    if (minor === null) continue;
    const currency = (str(v, "currency") ?? "USD").toUpperCase() === "EUR" ? "EUR" : "USD";
    const variantName = slugify(str(v, "printing", "variant", "condition") ?? "normal") || "normal";
    byKey.set(`tcgplayer:${variantName}:${currency}`, {
      source: "tcgplayer",
      variant: variantName,
      currency,
      normalizedPriceMinor: minor,
      lowMinor: toMinorUnits(str(v, "low", "lowPrice")),
      midMinor: toMinorUnits(str(v, "mid", "midPrice")),
      highMinor: toMinorUnits(str(v, "high", "highPrice")),
      marketMinor: toMinorUnits(str(v, "market", "marketPrice")),
      sourceUpdatedAt: str(v, "lastUpdated", "updatedAt"),
    });
  }

  return { card, prices: [...byKey.values()] };
}
