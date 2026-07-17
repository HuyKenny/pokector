import { describe, expect, it } from "vitest";

import { changeBetween, computePortfolioSummary } from "~/lib/portfolio/calc";

describe("computePortfolioSummary", () => {
  it("computes market value over priced entries only", () => {
    const s = computePortfolioSummary([
      { quantity: 2, currentPriceMinor: 1000, purchasePriceMinor: null },
      { quantity: 1, currentPriceMinor: null, purchasePriceMinor: null },
    ]);
    expect(s.marketValueMinor).toBe(2000);
    expect(s.pricedEntryCount).toBe(1);
    expect(s.unpricedEntryCount).toBe(1);
    expect(s.valuationCoveragePercent).toBe(50);
  });

  it("computes cost basis over entries with recorded cost only", () => {
    const s = computePortfolioSummary([
      { quantity: 3, currentPriceMinor: 500, purchasePriceMinor: 400 },
      { quantity: 1, currentPriceMinor: 500, purchasePriceMinor: null },
    ]);
    expect(s.costBasisMinor).toBe(1200);
    expect(s.costBasisCoveragePercent).toBe(50);
  });

  it("computes P/L and ROI only over matched entries (missing cost ≠ zero)", () => {
    const s = computePortfolioSummary([
      // matched: value 2000, cost 1000 → P/L +1000, ROI 100%
      { quantity: 2, currentPriceMinor: 1000, purchasePriceMinor: 500 },
      // priced but no cost — must NOT count as free profit
      { quantity: 1, currentPriceMinor: 99999, purchasePriceMinor: null },
      // cost but unpriced — must NOT count as total loss
      { quantity: 1, currentPriceMinor: null, purchasePriceMinor: 12345 },
    ]);
    expect(s.unrealizedPlMinor).toBe(1000);
    expect(s.roiPercent).toBe(100);
    expect(s.matchedMarketValueMinor).toBe(2000);
  });

  it("returns null ROI when nothing is matched", () => {
    const s = computePortfolioSummary([
      { quantity: 1, currentPriceMinor: 1000, purchasePriceMinor: null },
    ]);
    expect(s.roiPercent).toBeNull();
    expect(s.unrealizedPlMinor).toBe(0);
  });

  it("handles the empty collection", () => {
    const s = computePortfolioSummary([]);
    expect(s.marketValueMinor).toBe(0);
    expect(s.valuationCoveragePercent).toBe(0);
    expect(s.roiPercent).toBeNull();
    expect(s.totalQuantity).toBe(0);
  });

  it("stays in integer minor units (no float drift)", () => {
    const s = computePortfolioSummary(
      Array.from({ length: 1000 }, () => ({
        quantity: 3,
        currentPriceMinor: 333,
        purchasePriceMinor: 111,
      })),
    );
    expect(s.marketValueMinor).toBe(999_000);
    expect(s.costBasisMinor).toBe(333_000);
    expect(Number.isInteger(s.unrealizedPlMinor)).toBe(true);
  });
});

describe("changeBetween", () => {
  it("computes delta and percent", () => {
    expect(changeBetween(1100, 1000)).toEqual({ deltaMinor: 100, percent: 10 });
    expect(changeBetween(900, 1000)).toEqual({ deltaMinor: -100, percent: -10 });
  });

  it("returns null without a baseline (no fabricated change)", () => {
    expect(changeBetween(1000, null)).toBeNull();
    expect(changeBetween(1000, undefined)).toBeNull();
  });

  it("guards division by zero", () => {
    expect(changeBetween(500, 0)).toEqual({ deltaMinor: 500, percent: null });
  });
});
