import { describe, expect, it } from "vitest";

import {
  computeGradingRoi,
  DEFAULT_GRADING_TIER,
  GRADING_SHIPPING_MINOR,
  gradingTier,
} from "~/lib/grading/fees";

describe("computeGradingRoi", () => {
  it("adds raw cost, fee, and shipping into the all-in cost", () => {
    const r = computeGradingRoi({
      rawCostMinor: 1000,
      gradedValueMinor: 5000,
      feeMinor: 2500,
      shippingMinor: 2000,
    });
    expect(r.totalCostMinor).toBe(1000 + 2500 + 2000);
    expect(r.netMinor).toBe(5000 - 5500);
    expect(r.worthIt).toBe(false);
  });

  it("flags a profitable grade as worth it with a positive ROI", () => {
    const r = computeGradingRoi({
      rawCostMinor: 1000,
      gradedValueMinor: 20000,
      feeMinor: 2500,
      shippingMinor: 2000,
    });
    expect(r.netMinor).toBe(20000 - 5500);
    expect(r.worthIt).toBe(true);
    expect(r.roiPercent).toBeCloseTo((14500 / 5500) * 100, 5);
  });

  it("returns null ROI when there is no cost basis", () => {
    const r = computeGradingRoi({
      rawCostMinor: 0,
      gradedValueMinor: 0,
      feeMinor: 0,
      shippingMinor: 0,
    });
    expect(r.roiPercent).toBeNull();
    expect(r.worthIt).toBe(false);
  });
});

describe("grading tiers", () => {
  it("resolves the default tier and has a non-zero fee + shipping", () => {
    const tier = gradingTier(DEFAULT_GRADING_TIER);
    expect(tier.feeMinor).toBeGreaterThan(0);
    expect(GRADING_SHIPPING_MINOR).toBeGreaterThan(0);
  });

  it("falls back to the cheapest tier for an unknown id", () => {
    // @ts-expect-error — exercising the runtime fallback
    expect(gradingTier("nope").id).toBe("value");
  });
});
