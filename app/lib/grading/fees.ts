/**
 * PSA grading cost model + ROI math for the on-card "is it worth grading?"
 * calculator. All figures are USD minor units (cents) — the PSA graded market
 * that we price against (eBay Marketplace Insights) is USD.
 *
 * Fees are APPROXIMATE. PSA's published service pricing changes periodically and
 * depends on declared value / turnaround; these are round, current-ish defaults
 * meant for a break-even estimate, not a quote. Update in one place when PSA
 * changes its card. The UI labels this clearly as an estimate.
 */

export type GradingTierId = "value" | "regular" | "express";

export interface GradingTier {
  id: GradingTierId;
  /** Per-card PSA service fee, USD cents. */
  feeMinor: number;
  /** Declared-value ceiling for the tier, USD cents (null = effectively none). */
  maxDeclaredValueMinor: number | null;
}

/** Round-trip shipping + handling estimate (to PSA and back, insured), USD cents. */
export const GRADING_SHIPPING_MINOR = 2000;

/** Approximate PSA tiers (2025-ish). Ordered cheapest → priciest. */
export const GRADING_TIERS: readonly GradingTier[] = [
  { id: "value", feeMinor: 2500, maxDeclaredValueMinor: 50000 },
  { id: "regular", feeMinor: 7500, maxDeclaredValueMinor: 150000 },
  { id: "express", feeMinor: 15000, maxDeclaredValueMinor: 250000 },
] as const;

export const DEFAULT_GRADING_TIER: GradingTierId = "value";

export function gradingTier(id: GradingTierId): GradingTier {
  return GRADING_TIERS.find((t) => t.id === id) ?? GRADING_TIERS[0];
}

export interface GradingRoiInput {
  /** What you pay for the raw (ungraded) card, USD cents. */
  rawCostMinor: number;
  /** Expected graded sale price (PSA 9 or PSA 10 median), USD cents. */
  gradedValueMinor: number;
  /** PSA service fee, USD cents. */
  feeMinor: number;
  /** Round-trip shipping estimate, USD cents. */
  shippingMinor: number;
}

export interface GradingRoiResult {
  /** raw + fee + shipping. */
  totalCostMinor: number;
  /** gradedValue − totalCost (can be negative). */
  netMinor: number;
  /** net / totalCost × 100, or null when there is no cost to divide by. */
  roiPercent: number | null;
  /** True when the graded sale clears the all-in cost. */
  worthIt: boolean;
}

/**
 * Break-even ROI for sending a raw card to PSA: does the graded median sale
 * clear the raw cost plus grading fee plus shipping? Pure function — unit tested.
 */
export function computeGradingRoi(input: GradingRoiInput): GradingRoiResult {
  const totalCostMinor = input.rawCostMinor + input.feeMinor + input.shippingMinor;
  const netMinor = input.gradedValueMinor - totalCostMinor;
  const roiPercent = totalCostMinor > 0 ? (netMinor / totalCostMinor) * 100 : null;
  return { totalCostMinor, netMinor, roiPercent, worthIt: netMinor > 0 };
}
