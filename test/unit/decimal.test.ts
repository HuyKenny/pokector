import { describe, expect, it } from "vitest";

import { formatMinor, formatPercent, percent, toMinorUnits } from "~/lib/money/decimal";

describe("toMinorUnits", () => {
  it("parses integers and plain decimals", () => {
    expect(toMinorUnits(510)).toBe(51000);
    expect(toMinorUnits(719.99)).toBe(71999);
    expect(toMinorUnits(0.02)).toBe(2);
    expect(toMinorUnits("4184.6")).toBe(418460);
    expect(toMinorUnits("0")).toBe(0);
  });

  it("rounds half-up at the cent", () => {
    expect(toMinorUnits("1.005")).toBe(101);
    expect(toMinorUnits("1.004")).toBe(100);
    expect(toMinorUnits("1.0049")).toBe(100);
    expect(toMinorUnits("2.999")).toBe(300);
  });

  it("handles negative values", () => {
    expect(toMinorUnits("-3.50")).toBe(-350);
  });

  it("returns null for missing/invalid input (missing price stays missing)", () => {
    expect(toMinorUnits(null)).toBeNull();
    expect(toMinorUnits(undefined)).toBeNull();
    expect(toMinorUnits("")).toBeNull();
    expect(toMinorUnits("abc")).toBeNull();
    expect(toMinorUnits(Number.NaN)).toBeNull();
    expect(toMinorUnits(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("never uses float artifacts for typical feed values", () => {
    // Classic binary-float trap values.
    expect(toMinorUnits(0.1 + 0.2)).toBe(30);
    expect(toMinorUnits(1.1)).toBe(110);
    expect(toMinorUnits(19.99)).toBe(1999);
  });
});

describe("formatMinor / percent", () => {
  it("formats USD cents", () => {
    expect(formatMinor(77351)).toBe("$773.51");
    expect(formatMinor(null)).toBe("—");
  });

  it("formats EUR cents", () => {
    expect(formatMinor(418460, "EUR")).toBe("€4,184.60");
  });

  it("computes percentages safely", () => {
    expect(percent(50, 200)).toBe(25);
    expect(percent(50, 0)).toBeNull();
    expect(formatPercent(25)).toBe("+25.0%");
    expect(formatPercent(-3.14159, 2)).toBe("-3.14%");
    expect(formatPercent(null)).toBe("—");
  });
});
