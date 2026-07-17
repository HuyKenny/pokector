/**
 * Price normalization (SPEC §16). TCGplayer USD is primary (market → mid → low);
 * Cardmarket EUR is secondary (trend → averageSell → low). Sources are never
 * merged. All values become integer minor units via the decimal-safe parser.
 */

import type { CARD_VARIANTS } from "../db/schema";
import { toMinorUnits } from "../money/decimal";
import type { PtcgCardmarket, PtcgTcgplayer } from "../ptcg/types";

export type CardVariant = (typeof CARD_VARIANTS)[number];

/** Source variant key → Pokector variant. Unknown keys are skipped (no evidence,
 * no variant — SPEC §10). */
const TCGPLAYER_VARIANT_MAP: Record<string, CardVariant> = {
  normal: "normal",
  holofoil: "holofoil",
  reverseHolofoil: "reverseHolofoil",
  "1stEditionNormal": "firstEditionNormal",
  "1stEditionHolofoil": "firstEditionHolofoil",
  firstEditionNormal: "firstEditionNormal",
  firstEditionHolofoil: "firstEditionHolofoil",
};

export function mapTcgplayerVariant(sourceKey: string): CardVariant | null {
  return TCGPLAYER_VARIANT_MAP[sourceKey] ?? null;
}

/** "2026/07/16" → "2026-07-16" (kept as-is when already ISO or unknown shape). */
export function normalizeSourceDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4})[/-](\d{2})[/-](\d{2})$/.exec(value.trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : value.trim();
}

export interface NormalizedPriceRow {
  source: "tcgplayer" | "cardmarket";
  variant: CardVariant;
  currency: "USD" | "EUR";
  normalizedPriceMinor: number;
  lowMinor: number | null;
  midMinor: number | null;
  highMinor: number | null;
  marketMinor: number | null;
  directLowMinor: number | null;
  trendMinor: number | null;
  averageSellMinor: number | null;
  sourceUpdatedAt: string | null;
}

/** All price rows derivable from a card's TCGplayer block (may be empty). */
export function normalizeTcgplayerPrices(
  block: PtcgTcgplayer | null | undefined,
): NormalizedPriceRow[] {
  if (!block?.prices) return [];
  const sourceUpdatedAt = normalizeSourceDate(block.updatedAt);
  const rows: NormalizedPriceRow[] = [];

  for (const [sourceKey, prices] of Object.entries(block.prices)) {
    const variant = mapTcgplayerVariant(sourceKey);
    if (!variant || !prices) continue;

    const market = toMinorUnits(prices.market);
    const mid = toMinorUnits(prices.mid);
    const low = toMinorUnits(prices.low);
    // Selection order per SPEC §16: market → mid → low.
    const normalized = market ?? mid ?? low;
    if (normalized === null) continue; // no usable value = no price row

    rows.push({
      source: "tcgplayer",
      variant,
      currency: "USD",
      normalizedPriceMinor: normalized,
      lowMinor: low,
      midMinor: mid,
      highMinor: toMinorUnits(prices.high),
      marketMinor: market,
      directLowMinor: toMinorUnits(prices.directLow),
      trendMinor: null,
      averageSellMinor: null,
      sourceUpdatedAt,
    });
  }
  return rows;
}

/**
 * Cardmarket publishes one price block per card (no variant split). We attach it
 * to the card's known TCGplayer variants when available, else to "normal", so the
 * EUR value is displayable without inventing variant evidence.
 */
export function normalizeCardmarketPrices(
  block: PtcgCardmarket | null | undefined,
  knownVariants: CardVariant[],
): NormalizedPriceRow[] {
  if (!block?.prices) return [];
  const trend = toMinorUnits(block.prices.trendPrice);
  const averageSell = toMinorUnits(block.prices.averageSellPrice);
  const low = toMinorUnits(block.prices.lowPrice);
  // Selection order per SPEC §16: trend → averageSell → low.
  const normalized = trend ?? averageSell ?? low;
  if (normalized === null) return [];

  const sourceUpdatedAt = normalizeSourceDate(block.updatedAt);
  const variants = knownVariants.length > 0 ? knownVariants : (["normal"] as CardVariant[]);

  return variants.map((variant) => ({
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
    averageSellMinor: averageSell,
    sourceUpdatedAt,
  }));
}
