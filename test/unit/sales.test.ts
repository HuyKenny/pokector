import { describe, expect, it } from "vitest";

import {
  proceedsFor,
  realizedFor,
  summarizeSales,
  type SaleRow,
} from "~/lib/collection/sales.server";

function sale(over: Partial<SaleRow>): SaleRow {
  return {
    id: "s",
    cardId: "c",
    cardName: "Card",
    cardSlug: "card",
    setName: "Set",
    cardNumber: "1",
    imageSmallUrl: null,
    quantity: 1,
    variant: "normal",
    grade: "raw",
    salePriceMinor: 0,
    feeMinor: null,
    purchasePriceMinor: null,
    soldDate: "2026-01-01",
    notes: null,
    realizedPlMinor: null,
    proceedsMinor: 0,
    ...over,
  };
}

describe("realizedFor", () => {
  it("computes (sale − purchase) × qty − fee", () => {
    expect(
      realizedFor({ salePriceMinor: 5000, purchasePriceMinor: 1000, quantity: 2, feeMinor: 500 }),
    ).toBe((5000 - 1000) * 2 - 500);
  });

  it("returns null without a cost basis", () => {
    expect(
      realizedFor({ salePriceMinor: 5000, purchasePriceMinor: null, quantity: 1, feeMinor: null }),
    ).toBeNull();
  });
});

describe("proceedsFor", () => {
  it("is sale × qty − fee", () => {
    expect(proceedsFor({ salePriceMinor: 5000, quantity: 3, feeMinor: 700 })).toBe(5000 * 3 - 700);
  });
});

describe("summarizeSales", () => {
  it("sums proceeds over all sales but realized P/L only over priced ones", () => {
    const rows = [
      sale({
        salePriceMinor: 5000,
        purchasePriceMinor: 1000,
        quantity: 2,
        feeMinor: 500,
        realizedPlMinor: realizedFor({
          salePriceMinor: 5000,
          purchasePriceMinor: 1000,
          quantity: 2,
          feeMinor: 500,
        }),
        proceedsMinor: proceedsFor({ salePriceMinor: 5000, quantity: 2, feeMinor: 500 }),
      }),
      sale({
        salePriceMinor: 3000,
        purchasePriceMinor: null,
        quantity: 1,
        proceedsMinor: proceedsFor({ salePriceMinor: 3000, quantity: 1, feeMinor: null }),
      }),
    ];
    const s = summarizeSales(rows);
    expect(s.salesCount).toBe(2);
    expect(s.totalQuantity).toBe(3);
    expect(s.proceedsMinor).toBe(9500 + 3000);
    expect(s.realizedPlMinor).toBe((5000 - 1000) * 2 - 500);
    expect(s.costBasisMinor).toBe(1000 * 2);
    expect(s.unpricedCount).toBe(1);
  });
});
