/**
 * Streamed collection CSV export (SPEC §14). Uses the documented Pokector column
 * order, escapes every cell (formula-injection-safe), never exposes another
 * user's data (query is user-scoped), and streams rows so large collections
 * don't buffer in memory.
 */

import { and, asc, eq, sql, type SQL } from "drizzle-orm";

import { toCsvLine } from "./escape";
import { schema, type Database } from "../db/index.server";
import type { CollectionFilters } from "../collection/queries.server";

export const EXPORT_COLUMNS = [
  "pokector_card_id",
  "card_name",
  "set_id",
  "set_name",
  "card_number",
  "quantity",
  "variant",
  "condition",
  "language",
  "purchase_price",
  "purchase_currency",
  "purchase_date",
  "notes",
  "binder_name",
] as const;

/** Builds a streaming CSV Response for a user's collection (optionally filtered). */
export function streamCollectionCsv(
  db: Database,
  userId: string,
  filters: Pick<CollectionFilters, "setId" | "variant" | "condition">,
): Response {
  const conditions: SQL[] = [eq(schema.collectionEntries.userId, userId)];
  if (filters.setId) conditions.push(eq(schema.pokemonCards.setId, filters.setId));
  if (filters.variant) {
    conditions.push(
      eq(
        schema.collectionEntries.variant,
        filters.variant as (typeof schema.CARD_VARIANTS)[number],
      ),
    );
  }
  if (filters.condition) {
    conditions.push(
      eq(
        schema.collectionEntries.condition,
        filters.condition as (typeof schema.CONDITIONS)[number],
      ),
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(toCsvLine([...EXPORT_COLUMNS]) + "\r\n"));

      const PAGE = 500;
      let offset = 0;
      for (;;) {
        const rows = await db
          .select({
            cardId: schema.collectionEntries.cardId,
            cardName: schema.pokemonCards.name,
            setId: schema.pokemonCards.setId,
            setName: schema.pokemonSets.name,
            cardNumber: schema.pokemonCards.number,
            quantity: schema.collectionEntries.quantity,
            variant: schema.collectionEntries.variant,
            condition: schema.collectionEntries.condition,
            language: schema.collectionEntries.language,
            purchasePriceMinor: schema.collectionEntries.purchasePriceMinor,
            purchaseCurrency: schema.collectionEntries.purchaseCurrency,
            purchaseDate: schema.collectionEntries.purchaseDate,
            notes: schema.collectionEntries.notes,
            binderName: sql<string | null>`(
              SELECT b.name FROM binder_slots bs JOIN binders b ON b.id = bs.binder_id
              WHERE bs.collection_entry_id = ${schema.collectionEntries.id} LIMIT 1
            )`,
          })
          .from(schema.collectionEntries)
          .innerJoin(
            schema.pokemonCards,
            eq(schema.collectionEntries.cardId, schema.pokemonCards.id),
          )
          .innerJoin(schema.pokemonSets, eq(schema.pokemonCards.setId, schema.pokemonSets.id))
          .where(and(...conditions))
          .orderBy(asc(schema.collectionEntries.createdAt))
          .limit(PAGE)
          .offset(offset);

        if (rows.length === 0) break;
        for (const r of rows) {
          controller.enqueue(
            encoder.encode(
              toCsvLine([
                r.cardId,
                r.cardName,
                r.setId,
                r.setName,
                r.cardNumber,
                r.quantity,
                r.variant,
                r.condition,
                r.language,
                r.purchasePriceMinor !== null ? (r.purchasePriceMinor / 100).toFixed(2) : "",
                r.purchaseCurrency,
                r.purchaseDate ?? "",
                r.notes ?? "",
                r.binderName ?? "",
              ]) + "\r\n",
            ),
          );
        }
        if (rows.length < PAGE) break;
        offset += PAGE;
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pokector-collection-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
