/**
 * Pokector CSV import validation (SPEC §14), pure so it is unit-testable.
 * Card resolution order: pokector_card_id first, then (set_id + card_number).
 * Name-only matching is never used silently. Rows are validated into typed
 * actions or row errors; the caller resolves cards against D1 and commits.
 */

import { toMinorUnits } from "../money/decimal";
import { CARD_VARIANTS, CONDITIONS } from "../enums";

export const IMPORT_COLUMNS = [
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

export interface ParsedImportRow {
  rowNumber: number;
  cardId: string | null;
  setId: string | null;
  cardNumber: string | null;
  cardName: string | null;
  quantity: number;
  variant: (typeof CARD_VARIANTS)[number];
  condition: (typeof CONDITIONS)[number];
  language: string;
  purchasePriceMinor: number | null;
  purchaseCurrency: "USD" | "EUR";
  purchaseDate: string | null;
  notes: string | null;
}

export interface RowError {
  rowNumber: number;
  message: string;
}

export interface ValidatedImport {
  rows: ParsedImportRow[];
  errors: RowError[];
}

const VARIANT_SET = new Set<string>(CARD_VARIANTS);
const CONDITION_SET = new Set<string>(CONDITIONS);

function columnIndex(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  header.forEach((name, i) => {
    map[name] = i;
  });
  return map;
}

export function validateImportRows(header: string[], rows: string[][]): ValidatedImport {
  const idx = columnIndex(header);
  const get = (row: string[], col: string): string =>
    idx[col] !== undefined ? (row[idx[col]] ?? "").trim() : "";

  const parsed: ParsedImportRow[] = [];
  const errors: RowError[] = [];

  const hasIdColumn = idx.pokector_card_id !== undefined;
  const hasSetNumber = idx.set_id !== undefined && idx.card_number !== undefined;
  if (!hasIdColumn && !hasSetNumber) {
    errors.push({
      rowNumber: 0,
      message:
        "CSV must contain either a pokector_card_id column, or both set_id and card_number columns.",
    });
    return { rows: parsed, errors };
  }

  rows.forEach((row, i) => {
    const rowNumber = i + 2; // 1-based + header row
    const cardId = get(row, "pokector_card_id") || null;
    const setId = get(row, "set_id") || null;
    const cardNumber = get(row, "card_number") || null;

    if (!cardId && !(setId && cardNumber)) {
      errors.push({
        rowNumber,
        message: "Row needs pokector_card_id, or both set_id and card_number.",
      });
      return;
    }

    const quantityRaw = get(row, "quantity") || "1";
    const quantity = Number.parseInt(quantityRaw, 10);
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 10000) {
      errors.push({ rowNumber, message: `Invalid quantity "${quantityRaw}".` });
      return;
    }

    const variantRaw = get(row, "variant") || "normal";
    if (!VARIANT_SET.has(variantRaw)) {
      errors.push({ rowNumber, message: `Unknown variant "${variantRaw}".` });
      return;
    }

    const conditionRaw = get(row, "condition") || "Near Mint";
    if (!CONDITION_SET.has(conditionRaw)) {
      errors.push({ rowNumber, message: `Unknown condition "${conditionRaw}".` });
      return;
    }

    const priceRaw = get(row, "purchase_price");
    let purchasePriceMinor: number | null = null;
    if (priceRaw !== "") {
      purchasePriceMinor = toMinorUnits(priceRaw);
      if (purchasePriceMinor === null || purchasePriceMinor < 0) {
        errors.push({ rowNumber, message: `Invalid purchase_price "${priceRaw}".` });
        return;
      }
    }

    const currencyRaw = (get(row, "purchase_currency") || "USD").toUpperCase();
    if (currencyRaw !== "USD" && currencyRaw !== "EUR") {
      errors.push({ rowNumber, message: `Unsupported purchase_currency "${currencyRaw}".` });
      return;
    }

    const dateRaw = get(row, "purchase_date");
    if (dateRaw !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
      errors.push({ rowNumber, message: `Invalid purchase_date "${dateRaw}" (use YYYY-MM-DD).` });
      return;
    }

    parsed.push({
      rowNumber,
      cardId,
      setId,
      cardNumber,
      cardName: get(row, "card_name") || null,
      quantity,
      variant: variantRaw as (typeof CARD_VARIANTS)[number],
      condition: conditionRaw as (typeof CONDITIONS)[number],
      language: get(row, "language") || "English",
      purchasePriceMinor,
      purchaseCurrency: currencyRaw,
      purchaseDate: dateRaw || null,
      notes: get(row, "notes").slice(0, 1000) || null,
    });
  });

  return { rows: parsed, errors };
}
