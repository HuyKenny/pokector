/**
 * Pure helpers for the TCGdex Cardmarket feed. Our ids follow the Pokémon TCG
 * API; TCGdex renames many sets (sv1 → sv01, sm35 → sm3.5, pgo → swsh10.5) and
 * pads card numbers per set (sv01-001 but swsh3.5-1), so sets are matched by id
 * or unique name and cards by normalized number from the set's own card list.
 */
import { toMinorUnits } from "../money/decimal";
import type { CardVariant, NormalizedPriceRow } from "../pricing/normalize";
import { normalizeCardNumber, normalizeName } from "../tcgcsv/match";
import type { TcgdexCardmarket, TcgdexSetBrief } from "./client.server";

/** Our set id → TCGdex set id. Unmatched sets are absent (no guessing). */
export function matchSetsToTcgdex(
  sets: { id: string; name: string }[],
  tcgdexSets: TcgdexSetBrief[],
): Record<string, string> {
  const ids = new Set(tcgdexSets.map((s) => s.id));
  const byName = new Map<string, string[]>();
  for (const s of tcgdexSets) {
    const key = normalizeName(s.name);
    byName.set(key, [...(byName.get(key) ?? []), s.id]);
  }
  const result: Record<string, string> = {};
  for (const set of sets) {
    if (ids.has(set.id)) {
      result[set.id] = set.id;
      continue;
    }
    const byNameIds = byName.get(normalizeName(set.name)) ?? [];
    if (byNameIds.length === 1) result[set.id] = byNameIds[0];
  }
  return result;
}

/** Normalized card number → TCGdex card id, dropping numbers used twice. */
export function cardIdsByNumber(cards: { id: string; localId: string }[]): Record<string, string> {
  const result: Record<string, string> = {};
  const dupes = new Set<string>();
  for (const c of cards) {
    const key = normalizeCardNumber(c.localId);
    if (key in result) dupes.add(key);
    result[key] = c.id;
  }
  for (const key of dupes) delete result[key];
  return result;
}

/** Cardmarket block → one EUR row per known variant (SPEC §16: trend → avg →
 * low), dated with the feed's own timestamp. Empty when there is no usable value. */
export function cardmarketRows(
  block: TcgdexCardmarket | null | undefined,
  variants: CardVariant[],
): NormalizedPriceRow[] {
  if (!block) return [];
  const trend = toMinorUnits(block.trend ?? null);
  const average = toMinorUnits(block.avg ?? null);
  const low = toMinorUnits(block.low ?? null);
  const normalized = trend ?? average ?? low;
  if (normalized === null) return [];
  const date = block.updated?.slice(0, 10) ?? null;
  return (variants.length > 0 ? variants : (["normal"] as CardVariant[])).map((variant) => ({
    source: "cardmarket" as const,
    variant,
    currency: "EUR" as const,
    normalizedPriceMinor: normalized,
    lowMinor: low,
    midMinor: null,
    highMinor: null,
    marketMinor: null,
    directLowMinor: null,
    trendMinor: trend,
    averageSellMinor: average,
    sourceUpdatedAt: date,
  }));
}
