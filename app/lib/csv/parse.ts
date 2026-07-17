/**
 * Minimal, bounded CSV parser (SPEC §14). Handles quoted fields, escaped quotes
 * ("") and CRLF/LF. Enforces a row cap to bound memory/CPU. Treats all cell
 * content as data — never evaluates formulas.
 */

export interface ParsedCsv {
  header: string[];
  rows: string[][];
  /** True if the row cap was hit and parsing stopped early. */
  truncated: boolean;
}

export function parseCsv(input: string, maxRows: number): ParsedCsv {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let truncated = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    // Skip fully-empty trailing rows.
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n") {
      pushRow();
      if (rows.length > maxRows) {
        truncated = true;
        break;
      }
    } else if (ch === "\r") {
      // handled by the following \n (or standalone CR → row break)
      if (input[i + 1] !== "\n") pushRow();
    } else {
      field += ch;
    }
  }
  // Trailing field/row without a final newline.
  if (!truncated && (field !== "" || row.length > 0)) pushRow();

  const header = rows.shift() ?? [];
  return {
    header: header.map((h) => h.trim().toLowerCase()),
    rows: rows.slice(0, maxRows),
    truncated: truncated || rows.length > maxRows,
  };
}
