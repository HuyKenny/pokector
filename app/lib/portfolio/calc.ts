/**
 * Portfolio mathematics (SPEC §9) — pure functions over integer minor units.
 *
 * Rules:
 * - Market value sums normalized price × quantity over PRICED entries only.
 * - Cost basis sums purchase price × quantity over entries WITH a recorded cost.
 * - P/L and ROI use only entries having BOTH a purchase price and a current
 *   price; a missing purchase price is never treated as zero.
 * - A missing price never becomes zero — it makes the entry "unpriced".
 */

export interface PortfolioEntryInput {
  quantity: number;
  /** Current normalized market price in minor units; null = unpriced. */
  currentPriceMinor: number | null;
  /** Recorded unit purchase price in minor units; null = not recorded. */
  purchasePriceMinor: number | null;
}

export interface PortfolioSummary {
  marketValueMinor: number;
  costBasisMinor: number;
  /** Market value of only the entries that also have a cost basis. */
  matchedMarketValueMinor: number;
  unrealizedPlMinor: number;
  /** ROI percent over matched entries; null when no matched cost basis. */
  roiPercent: number | null;
  totalEntries: number;
  pricedEntryCount: number;
  unpricedEntryCount: number;
  totalQuantity: number;
  /** % of entries with a current price. */
  valuationCoveragePercent: number;
  /** % of entries with a recorded purchase price. */
  costBasisCoveragePercent: number;
}

export function computePortfolioSummary(entries: PortfolioEntryInput[]): PortfolioSummary {
  let marketValueMinor = 0;
  let costBasisMinor = 0;
  let matchedMarketValueMinor = 0;
  let matchedCostBasisMinor = 0;
  let pricedEntryCount = 0;
  let totalQuantity = 0;
  let withCost = 0;

  for (const entry of entries) {
    totalQuantity += entry.quantity;
    const priced = entry.currentPriceMinor !== null;
    const hasCost = entry.purchasePriceMinor !== null;

    if (priced) {
      pricedEntryCount++;
      marketValueMinor += entry.currentPriceMinor! * entry.quantity;
    }
    if (hasCost) {
      withCost++;
      costBasisMinor += entry.purchasePriceMinor! * entry.quantity;
    }
    if (priced && hasCost) {
      matchedMarketValueMinor += entry.currentPriceMinor! * entry.quantity;
      matchedCostBasisMinor += entry.purchasePriceMinor! * entry.quantity;
    }
  }

  const unrealizedPlMinor = matchedMarketValueMinor - matchedCostBasisMinor;
  const total = entries.length;

  return {
    marketValueMinor,
    costBasisMinor,
    matchedMarketValueMinor,
    unrealizedPlMinor,
    roiPercent:
      matchedCostBasisMinor > 0 ? (unrealizedPlMinor / matchedCostBasisMinor) * 100 : null,
    totalEntries: total,
    pricedEntryCount,
    unpricedEntryCount: total - pricedEntryCount,
    totalQuantity,
    valuationCoveragePercent: total > 0 ? (pricedEntryCount / total) * 100 : 0,
    costBasisCoveragePercent: total > 0 ? (withCost / total) * 100 : 0,
  };
}

/** Change between two snapshot values; null when the baseline is missing. */
export function changeBetween(
  currentMinor: number,
  previousMinor: number | null | undefined,
): { deltaMinor: number; percent: number | null } | null {
  if (previousMinor === null || previousMinor === undefined) return null;
  const deltaMinor = currentMinor - previousMinor;
  return {
    deltaMinor,
    percent: previousMinor !== 0 ? (deltaMinor / previousMinor) * 100 : null,
  };
}
