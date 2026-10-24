/**
 * Slug + normalization helpers for catalog entities.
 *
 * Card slug: `<set-id>-<number>-<name>` (e.g. "base1-4-charizard") — unique because
 * (set, number) is unique in the source data, stable across name tweaks, readable.
 * Set slug: slugified set name, with the external set ID as tiebreaker fallback.
 */

const DIACRITICS = /[̀-ͯ]/g;

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(/[♀]/g, "-f")
    .replace(/[♂]/g, "-m")
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/**
 * Card numbers that are pure punctuation (Unseen Forces has Unown "?" and "!")
 * slugify to "" — and then both collide on "ex10--unown". Spell the symbols out.
 */
const NUMBER_SYMBOLS: Record<string, string> = { "?": "question", "!": "exclamation" };

function numberSlug(number: string): string {
  const plain = slugify(number);
  if (plain.length > 0) return plain;
  const spelled = slugify(
    [...number].map((ch) => NUMBER_SYMBOLS[ch] ?? `u${ch.codePointAt(0)?.toString(16)}`).join(" "),
  );
  return spelled.length > 0 ? spelled : "x";
}

export function cardSlug(setId: string, number: string, name: string): string {
  return `${slugify(setId)}-${numberSlug(number)}-${slugify(name)}`;
}

export function setSlug(setId: string, name: string): string {
  const base = slugify(name);
  return base.length > 0 ? base : slugify(setId);
}

/** Lower-cased, diacritics-stripped form used for name search columns. */
export function normalizeName(input: string): string {
  return input.normalize("NFKD").replace(DIACRITICS, "").toLowerCase().trim();
}

/** Numeric prefix of a card number for ordering ("25a" → 25, "SWSH001" → 1, "XY" → 0). */
export function numberSortKey(number: string): number {
  const match = /(\d+)/.exec(number);
  return match ? Number.parseInt(match[1], 10) : 0;
}
