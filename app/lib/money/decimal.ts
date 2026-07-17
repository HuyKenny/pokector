/**
 * Decimal-safe money parsing (SPEC §16). External price feeds provide decimal
 * values (as JSON numbers or strings); we convert them to integer minor units
 * without binary floating-point arithmetic on the value digits: the input is
 * rendered to a decimal string and parsed with integer math, rounding half-up
 * at the cent.
 */

const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Parse a decimal value into integer minor units (2 fraction digits).
 * Returns null for invalid/absent input — a missing price must stay missing.
 */
export function toMinorUnits(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;

  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    // Render without exponent; 20 significant digits covers all feed values.
    text = value.toFixed(10);
  } else {
    text = value.trim();
    if (text === "") return null;
  }

  const match = DECIMAL_PATTERN.exec(text);
  if (!match) return null;

  const sign = match[1] === "-" ? -1 : 1;
  const wholePart = match[2];
  const fraction = (match[3] ?? "").padEnd(3, "0");

  const cents = BigInt(wholePart) * 100n + BigInt(fraction.slice(0, 2));
  // Round half-up on the third fraction digit.
  const roundUp = Number(fraction[2]) >= 5 ? 1n : 0n;
  const total = (cents + roundUp) * BigInt(sign);

  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(-Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return Number(total);
}

/** Format minor units for display (en-US), e.g. 77351 → "$773.51". */
export function formatMinor(
  minor: number | null | undefined,
  currency: "USD" | "EUR" = "USD",
  locale = "en-US",
): string {
  if (minor === null || minor === undefined) return "—";
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
}

/**
 * Percentage of part over base in basis points precision, formatted at display
 * time only. Returns null when base is zero/absent (never divide by zero).
 */
export function percent(part: number, base: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(base) || base === 0) return null;
  return (part / base) * 100;
}

export function formatPercent(value: number | null, digits = 1): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}
