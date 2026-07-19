/**
 * Full-text search helpers for the `card_search` FTS5 table (migration 0007).
 *
 * The table is populated from the catalog sync (see catalog.server.ts) and a
 * one-time backfill. Queries are tokenized: each word becomes a prefix term and
 * all terms must match (AND), so "base charizard" and "charizard 4/102" work and
 * rank by bm25. A relaxed OR variant powers "did you mean" suggestions.
 */
import { normalizeName } from "../seo/slug";

/** FTS5 column order — must match the CREATE VIRTUAL TABLE in migration 0007. */
export const CARD_SEARCH_COLUMNS = [
  "card_id",
  "name",
  "set_name",
  "series",
  "number",
  "rarity",
  "artist",
  "dex",
  "supertype",
] as const;

/**
 * bm25 column weights (same order as the columns; card_id is UNINDEXED = 0).
 * Higher weight → stronger relevance. Name dominates, then number and set name.
 */
export const CARD_SEARCH_BM25_WEIGHTS = [0, 10, 3, 1, 6, 1, 2, 2, 1.5] as const;

/**
 * Build an FTS5 MATCH expression from a user query. Splits on any non-alphanumeric
 * (so "4/102" → tokens "4","102"), lowercases/strips diacritics, wraps each token
 * as a prefix term, and joins them with AND (default) or OR (relaxed suggestions).
 * Returns null when the query has no usable tokens.
 */
export function buildFtsMatch(q: string, mode: "and" | "or" = "and"): string | null {
  const tokens = normalizeName(q)
    .slice(0, 80)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 12);
  if (tokens.length === 0) return null;
  // Tokens are pure alphanumerics after the split → safe to quote. Purely numeric
  // tokens (card numbers) match exactly so "4/102" doesn't also hit #40–#49; text
  // tokens stay prefix so "chari" finds "charizard".
  const terms = tokens.map((t) => (/^\d+$/.test(t) ? `"${t}"` : `"${t}"*`));
  return terms.join(mode === "or" ? " OR " : " ");
}

function parseJsonArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const arr: unknown = JSON.parse(json);
    return Array.isArray(arr) ? arr.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}

export interface FtsCardInput {
  id: string;
  name: string;
  number: string;
  /** Set size — indexed with the number so "4/102" (number/total) matches. */
  printedTotal: number | null | undefined;
  rarity: string | null | undefined;
  artist: string | null | undefined;
  supertype: string | null | undefined;
  subtypesJson: string | null | undefined;
  nationalPokedexNumbersJson: string | null | undefined;
  setName: string;
  series: string;
}

/** The nine `card_search` column values for a card (order matches the table). */
export function ftsRowValues(c: FtsCardInput): [string, string, string, string, string, string, string, string, string] {
  const dex = parseJsonArray(c.nationalPokedexNumbersJson).join(" ");
  const subtypes = parseJsonArray(c.subtypesJson).join(" ");
  // "4" plus the set total ("102") so collectors can type "4/102".
  const number = [c.number, c.printedTotal != null ? String(c.printedTotal) : ""]
    .filter(Boolean)
    .join(" ");
  return [
    c.id,
    c.name,
    c.setName,
    c.series,
    number,
    c.rarity ?? "",
    c.artist ?? "",
    dex,
    [c.supertype ?? "", subtypes].filter(Boolean).join(" "),
  ];
}
