/**
 * Plain enum arrays shared by client components and the Drizzle schema.
 * Kept free of server-only imports so UI code can reference them without
 * pulling the D1/server modules into the client bundle.
 */

export const PRICE_SOURCES = ["tcgplayer", "cardmarket"] as const;

export const CARD_VARIANTS = [
  "normal",
  "holofoil",
  "reverseHolofoil",
  "firstEditionNormal",
  "firstEditionHolofoil",
] as const;

export const CONDITIONS = [
  "Near Mint",
  "Lightly Played",
  "Moderately Played",
  "Heavily Played",
  "Damaged",
] as const;

/** Card grade: raw (ungraded) or PSA-graded. Orthogonal to print variant.
 * Graded prices come from eBay lowest-listing lookups (see ebay-api.server.ts). */
export const GRADES = ["raw", "psa9", "psa10"] as const;

export type PriceSource = (typeof PRICE_SOURCES)[number];
export type CardVariant = (typeof CARD_VARIANTS)[number];
export type Condition = (typeof CONDITIONS)[number];
export type Grade = (typeof GRADES)[number];
