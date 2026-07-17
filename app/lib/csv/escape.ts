/**
 * CSV serialization with correct quoting and spreadsheet-formula-injection
 * protection (SPEC §14/§22): cells starting with = + - @ or tab/CR are prefixed
 * with a single quote so spreadsheet apps treat them as text.
 */

const DANGEROUS_PREFIX = /^[=+\-@\t\r]/;

export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (DANGEROUS_PREFIX.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function toCsvLine(cells: (string | number | null | undefined)[]): string {
  return cells.map(escapeCsvCell).join(",");
}
