import { describe, expect, it } from "vitest";

import { robustListingEstimate } from "~/lib/affiliate/ebay-api.server";

describe("robustListingEstimate", () => {
  it("returns null for no prices", () => {
    expect(robustListingEstimate([])).toBeNull();
  });

  it("drops non-finite / non-positive values", () => {
    expect(robustListingEstimate([0, -5, Number.NaN, Infinity])).toBeNull();
  });

  it("a single listing reports itself as value, low=high, count=1", () => {
    const r = robustListingEstimate([1234])!;
    expect(r).toMatchObject({
      estimateMinor: 1234,
      lowMinor: 1234,
      highMinor: 1234,
      count: 1,
      lowestMinor: 1234,
    });
  });

  it("small sample (no trim) uses the plain median; lowest stays the true min", () => {
    // odd count, no trim (count < 8)
    const r = robustListingEstimate([300, 100, 200])!;
    expect(r.estimateMinor).toBe(200); // median of 100,200,300
    expect(r.lowestMinor).toBe(100);
    expect(r.lowMinor).toBe(100);
    expect(r.highMinor).toBe(300);
    expect(r.count).toBe(3);
  });

  it("even small sample averages the two middle values", () => {
    const r = robustListingEstimate([100, 200, 300, 400])!;
    expect(r.estimateMinor).toBe(250); // (200+300)/2
  });

  it("trims outliers on large samples so a lowball/overprice can't skew the value", () => {
    // 10 clustered ~1000 comps + 1 lowball + 1 wild overprice = 12 values.
    const cluster = [980, 990, 1000, 1000, 1010, 1010, 1020, 1020, 1030, 1040];
    const r = robustListingEstimate([5, ...cluster, 999999])!;
    // count reports the full accepted sample...
    expect(r.count).toBe(12);
    // ...but the estimate + range come from the trimmed middle (outliers gone).
    expect(r.lowMinor).toBeGreaterThan(5);
    expect(r.highMinor).toBeLessThan(999999);
    expect(r.estimateMinor).toBeGreaterThan(950);
    expect(r.estimateMinor).toBeLessThan(1100);
    // The "from $X" CTA still points at the genuine cheapest listing.
    expect(r.lowestMinor).toBe(5);
  });
});
