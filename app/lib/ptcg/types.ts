/**
 * Pokémon TCG API v2 response validation (SPEC §15). Schemas are deliberately
 * permissive beyond the fields we consume: unknown additions must not break the
 * sync, while required identity fields are enforced.
 */

import { z } from "zod";

export const PtcgPriceBlockSchema = z
  .object({
    low: z.number().nullish(),
    mid: z.number().nullish(),
    high: z.number().nullish(),
    market: z.number().nullish(),
    directLow: z.number().nullish(),
  })
  .loose();

export const PtcgTcgplayerSchema = z
  .object({
    url: z.string().nullish(),
    updatedAt: z.string().nullish(),
    prices: z.record(z.string(), PtcgPriceBlockSchema).nullish(),
  })
  .loose();

export const PtcgCardmarketSchema = z
  .object({
    url: z.string().nullish(),
    updatedAt: z.string().nullish(),
    prices: z
      .object({
        trendPrice: z.number().nullish(),
        averageSellPrice: z.number().nullish(),
        lowPrice: z.number().nullish(),
      })
      .loose()
      .nullish(),
  })
  .loose();

export const PtcgSetSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    series: z.string().default("Other"),
    printedTotal: z.number().int().nullish(),
    total: z.number().int().nullish(),
    releaseDate: z.string().nullish(),
    updatedAt: z.string().nullish(),
    images: z
      .object({ symbol: z.string().nullish(), logo: z.string().nullish() })
      .loose()
      .nullish(),
  })
  .loose();

export const PtcgCardSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    number: z.string().min(1),
    supertype: z.string().nullish(),
    subtypes: z.array(z.string()).nullish(),
    hp: z.string().nullish(),
    types: z.array(z.string()).nullish(),
    rarity: z.string().nullish(),
    artist: z.string().nullish(),
    nationalPokedexNumbers: z.array(z.number()).nullish(),
    regulationMark: z.string().nullish(),
    set: z.object({ id: z.string().min(1) }).loose(),
    images: z
      .object({ small: z.string().nullish(), large: z.string().nullish() })
      .loose()
      .nullish(),
    tcgplayer: PtcgTcgplayerSchema.nullish(),
    cardmarket: PtcgCardmarketSchema.nullish(),
  })
  .loose();

export const PtcgListResponseSchema = z.object({
  data: z.array(z.unknown()),
  page: z.number().int().optional(),
  pageSize: z.number().int().optional(),
  count: z.number().int().optional(),
  totalCount: z.number().int(),
});

export type PtcgSet = z.infer<typeof PtcgSetSchema>;
export type PtcgCard = z.infer<typeof PtcgCardSchema>;
export type PtcgTcgplayer = z.infer<typeof PtcgTcgplayerSchema>;
export type PtcgCardmarket = z.infer<typeof PtcgCardmarketSchema>;
