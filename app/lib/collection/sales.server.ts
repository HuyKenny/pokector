/**
 * Sales / realized P&L repository. Recording a sale snapshots the source entry's
 * cost basis (purchase price per card) into `card_sales` so realized history is
 * immutable to later edits. Cost basis is lot-accurate because the user sells
 * from a specific collection entry (the chosen lot), so no separate FIFO engine
 * is needed. Every query is scoped to the authenticated user (BOLA defense).
 */
import { and, desc, eq } from "drizzle-orm";

import { schema, type Database } from "../db/index.server";
import { deleteEntries, updateEntry } from "./queries.server";

export interface SellInput {
  entryId: string;
  quantity: number;
  /** Sale price per card, USD minor units. */
  salePriceMinor: number;
  /** Optional selling/shipping fees for the whole sale, USD minor units. */
  feeMinor: number | null;
  /** "YYYY-MM-DD". */
  soldDate: string;
  notes: string | null;
}

/**
 * Record a sale of `quantity` copies from a collection entry. Reduces (or
 * removes) the entry, writing a card_sales row with the cost basis copied from
 * the entry. Returns a small result for the action's flash message.
 */
export async function recordSale(
  db: Database,
  userId: string,
  input: SellInput,
): Promise<{ ok: boolean; message: string }> {
  const entry = await db.query.collectionEntries.findFirst({
    where: and(
      eq(schema.collectionEntries.id, input.entryId),
      eq(schema.collectionEntries.userId, userId),
    ),
  });
  if (!entry) return { ok: false, message: "Entry not found." };

  const soldQty = Math.min(input.quantity, entry.quantity);
  if (soldQty < 1) return { ok: false, message: "Nothing to sell." };

  await db.insert(schema.cardSales).values({
    id: crypto.randomUUID(),
    userId,
    cardId: entry.cardId,
    collectionEntryId: entry.id,
    quantity: soldQty,
    variant: entry.variant,
    grade: entry.grade,
    saleCurrency: "USD",
    salePriceMinor: input.salePriceMinor,
    feeMinor: input.feeMinor,
    purchasePriceMinor: entry.purchasePriceMinor,
    purchaseCurrency: entry.purchaseCurrency,
    purchaseDate: entry.purchaseDate,
    soldDate: input.soldDate,
    notes: input.notes,
  });

  // Draw the sold copies down from the lot; remove the entry when it hits zero
  // (deleteEntries keeps tracked counts + set progress in sync).
  if (soldQty >= entry.quantity) {
    await deleteEntries(db, userId, [entry.id]);
  } else {
    await updateEntry(db, userId, entry.id, { quantity: entry.quantity - soldQty });
  }

  return { ok: true, message: `Recorded sale of ${soldQty} × ${entry.variant}.` };
}

export interface SaleRow {
  id: string;
  cardId: string;
  cardName: string;
  cardSlug: string;
  setName: string;
  cardNumber: string;
  imageSmallUrl: string | null;
  quantity: number;
  variant: string;
  grade: (typeof schema.GRADES)[number];
  salePriceMinor: number;
  feeMinor: number | null;
  purchasePriceMinor: number | null;
  soldDate: string;
  notes: string | null;
  /** (sale − purchase) × qty − fee, or null when no cost basis was recorded. */
  realizedPlMinor: number | null;
  /** sale × qty − fee. */
  proceedsMinor: number;
}

/** Per-sale realized P&L (null when the lot had no recorded purchase price). */
export function realizedFor(sale: {
  salePriceMinor: number;
  purchasePriceMinor: number | null;
  quantity: number;
  feeMinor: number | null;
}): number | null {
  if (sale.purchasePriceMinor === null) return null;
  return (
    (sale.salePriceMinor - sale.purchasePriceMinor) * sale.quantity - (sale.feeMinor ?? 0)
  );
}

/** Proceeds net of fees for a sale. */
export function proceedsFor(sale: {
  salePriceMinor: number;
  quantity: number;
  feeMinor: number | null;
}): number {
  return sale.salePriceMinor * sale.quantity - (sale.feeMinor ?? 0);
}

export async function listSales(
  db: Database,
  userId: string,
  opts: { year?: number } = {},
): Promise<SaleRow[]> {
  const rows = await db
    .select({
      id: schema.cardSales.id,
      cardId: schema.cardSales.cardId,
      cardName: schema.pokemonCards.name,
      cardSlug: schema.pokemonCards.slug,
      setName: schema.pokemonSets.name,
      cardNumber: schema.pokemonCards.number,
      imageSmallUrl: schema.pokemonCards.imageSmallUrl,
      quantity: schema.cardSales.quantity,
      variant: schema.cardSales.variant,
      grade: schema.cardSales.grade,
      salePriceMinor: schema.cardSales.salePriceMinor,
      feeMinor: schema.cardSales.feeMinor,
      purchasePriceMinor: schema.cardSales.purchasePriceMinor,
      soldDate: schema.cardSales.soldDate,
      notes: schema.cardSales.notes,
    })
    .from(schema.cardSales)
    .innerJoin(schema.pokemonCards, eq(schema.cardSales.cardId, schema.pokemonCards.id))
    .innerJoin(schema.pokemonSets, eq(schema.pokemonCards.setId, schema.pokemonSets.id))
    .where(eq(schema.cardSales.userId, userId))
    .orderBy(desc(schema.cardSales.soldDate), desc(schema.cardSales.createdAt))
    .limit(1000);

  return rows
    .filter((r) => (opts.year ? r.soldDate.slice(0, 4) === String(opts.year) : true))
    .map((r) => ({
      ...r,
      realizedPlMinor: realizedFor(r),
      proceedsMinor: proceedsFor(r),
    }));
}

export interface RealizedSummary {
  salesCount: number;
  totalQuantity: number;
  proceedsMinor: number;
  /** Realized P&L over sales that had a recorded cost basis. */
  realizedPlMinor: number;
  /** Cost basis (purchase × qty) over those same sales. */
  costBasisMinor: number;
  /** Sales missing a purchase price (excluded from realized P&L). */
  unpricedCount: number;
}

export function summarizeSales(sales: SaleRow[]): RealizedSummary {
  let proceeds = 0;
  let realized = 0;
  let costBasis = 0;
  let qty = 0;
  let unpriced = 0;
  for (const s of sales) {
    proceeds += s.proceedsMinor;
    qty += s.quantity;
    if (s.realizedPlMinor === null || s.purchasePriceMinor === null) {
      unpriced += 1;
    } else {
      realized += s.realizedPlMinor;
      costBasis += s.purchasePriceMinor * s.quantity;
    }
  }
  return {
    salesCount: sales.length,
    totalQuantity: qty,
    proceedsMinor: proceeds,
    realizedPlMinor: realized,
    costBasisMinor: costBasis,
    unpricedCount: unpriced,
  };
}
