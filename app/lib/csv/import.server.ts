/**
 * Server-side CSV import: resolve validated rows to real catalog card IDs and
 * apply them (SPEC §14). Resolution order: pokector_card_id, then
 * (set_id + card_number). Unresolved rows become row errors, never silent
 * name-only matches. Commit runs as a background job (import_apply) so large
 * imports don't block a request.
 */

import { and, eq, inArray } from "drizzle-orm";

import { schema, type Database } from "../db/index.server";
import { bumpTrackedCounts } from "../collection/tracked.server";
import { invalidateProgressForCard } from "../sets/progress.server";
import { addJobLog, type SyncJob } from "../jobs/queue.server";
import { createDb } from "../db/index.server";
import type { ParsedImportRow, RowError } from "./import";

export interface ResolvedRow extends ParsedImportRow {
  resolvedCardId: string;
}

export interface ResolutionResult {
  resolved: ResolvedRow[];
  errors: RowError[];
}

/** Resolve validated rows against the catalog (batched, no name-only matching). */
export async function resolveRows(
  db: Database,
  rows: ParsedImportRow[],
): Promise<ResolutionResult> {
  const resolved: ResolvedRow[] = [];
  const errors: RowError[] = [];

  const byId = rows.filter((r) => r.cardId);
  const bySetNumber = rows.filter((r) => !r.cardId && r.setId && r.cardNumber);

  // Batch-check direct card IDs.
  const idSet = new Set<string>();
  if (byId.length > 0) {
    const ids = [...new Set(byId.map((r) => r.cardId as string))];
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const found = await db
        .select({ id: schema.pokemonCards.id })
        .from(schema.pokemonCards)
        .where(inArray(schema.pokemonCards.id, chunk));
      for (const row of found) idSet.add(row.id);
    }
  }

  // Batch-resolve (set_id, number) pairs.
  const pairKey = (setId: string, number: string) => `${setId}::${number}`;
  const pairMap = new Map<string, string>();
  if (bySetNumber.length > 0) {
    const setIds = [...new Set(bySetNumber.map((r) => r.setId as string))];
    for (let i = 0; i < setIds.length; i += 90) {
      const chunk = setIds.slice(i, i + 90);
      const found = await db
        .select({
          id: schema.pokemonCards.id,
          setId: schema.pokemonCards.setId,
          number: schema.pokemonCards.number,
        })
        .from(schema.pokemonCards)
        .where(inArray(schema.pokemonCards.setId, chunk));
      for (const row of found) pairMap.set(pairKey(row.setId, row.number), row.id);
    }
  }

  for (const row of rows) {
    if (row.cardId) {
      if (idSet.has(row.cardId)) {
        resolved.push({ ...row, resolvedCardId: row.cardId });
      } else {
        errors.push({ rowNumber: row.rowNumber, message: `Unknown card ID "${row.cardId}".` });
      }
      continue;
    }
    const key = pairKey(row.setId as string, row.cardNumber as string);
    const cardId = pairMap.get(key);
    if (cardId) {
      resolved.push({ ...row, resolvedCardId: cardId });
    } else {
      errors.push({
        rowNumber: row.rowNumber,
        message: `No card found for set "${row.setId}" number "${row.cardNumber}".`,
      });
    }
  }

  return { resolved, errors };
}

export interface ImportApplyPayload {
  userId: string;
  importJobId: string;
  mode: "append" | "merge";
  rows: ResolvedRow[];
}

/**
 * Job handler: apply resolved rows.
 * - append: always insert a new acquisition lot.
 * - merge: if an entry with the same (card, variant, condition, language)
 *   exists, add quantity to it (idempotent-ish); else insert.
 */
export async function handleImportApply(job: SyncJob, env: Env): Promise<void> {
  const db = createDb(env.DB);
  const payload = JSON.parse(job.payloadJson ?? "{}") as ImportApplyPayload;
  const { userId, importJobId, mode, rows } = payload;

  let successful = 0;
  let failed = 0;
  const touchedCards = new Set<string>();

  for (const row of rows) {
    try {
      if (mode === "merge") {
        const existing = await db
          .select({ id: schema.collectionEntries.id, quantity: schema.collectionEntries.quantity })
          .from(schema.collectionEntries)
          .where(
            and(
              eq(schema.collectionEntries.userId, userId),
              eq(schema.collectionEntries.cardId, row.resolvedCardId),
              eq(schema.collectionEntries.variant, row.variant),
              eq(schema.collectionEntries.condition, row.condition),
              eq(schema.collectionEntries.language, row.language),
            ),
          )
          .limit(1);
        if (existing[0]) {
          await db
            .update(schema.collectionEntries)
            .set({ quantity: existing[0].quantity + row.quantity })
            .where(eq(schema.collectionEntries.id, existing[0].id));
          successful++;
          touchedCards.add(row.resolvedCardId);
          continue;
        }
      }
      await db.insert(schema.collectionEntries).values({
        id: crypto.randomUUID(),
        userId,
        cardId: row.resolvedCardId,
        quantity: row.quantity,
        variant: row.variant,
        condition: row.condition,
        language: row.language,
        purchasePriceMinor: row.purchasePriceMinor,
        purchaseCurrency: row.purchaseCurrency,
        purchaseDate: row.purchaseDate,
        notes: row.notes,
      });
      touchedCards.add(row.resolvedCardId);
      successful++;
    } catch {
      failed++;
    }
    // Keep progress fresh for the UI.
    await db
      .update(schema.importJobs)
      .set({ processedRows: successful + failed, successfulRows: successful, failedRows: failed })
      .where(eq(schema.importJobs.id, importJobId));
  }

  for (const cardId of touchedCards) {
    await bumpTrackedCounts(db, cardId, { collection: 1 });
    await invalidateProgressForCard(db, userId, cardId);
  }

  await db
    .update(schema.importJobs)
    .set({
      status: "completed",
      processedRows: successful + failed,
      successfulRows: successful,
      failedRows: failed,
      completedAt: new Date(),
      payloadJson: null, // clear the row payload once applied
    })
    .where(eq(schema.importJobs.id, importJobId));

  // Notify the user their import finished.
  await db.insert(schema.notifications).values({
    id: crypto.randomUUID(),
    userId,
    type: "import_finished",
    title: "CSV import finished",
    message: `${successful} ${successful === 1 ? "entry" : "entries"} imported${failed > 0 ? `, ${failed} failed` : ""}.`,
    payloadJson: null,
  });

  await addJobLog(db, job.id, "info", "import.applied", { successful, failed, mode });
}
