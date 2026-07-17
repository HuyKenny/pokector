import { describe, expect, it } from "vitest";

import { ALERT_COOLDOWN_MS, evaluateAlert } from "~/lib/alerts/evaluate";

const NOW = 1_800_000_000_000;

describe("evaluateAlert (crossing behavior)", () => {
  it("does not trigger on first observation (nothing to cross)", () => {
    const r = evaluateAlert({
      targetMinor: 2500,
      direction: "below",
      currentMinor: 2000,
      priorState: null,
      lastAlertedAt: null,
      now: NOW,
    });
    expect(r.shouldTrigger).toBe(false);
    expect(r.newState).toBe("below");
  });

  it("triggers when the price crosses below the target", () => {
    const r = evaluateAlert({
      targetMinor: 2500,
      direction: "below",
      currentMinor: 2400,
      priorState: "above",
      lastAlertedAt: null,
      now: NOW,
    });
    expect(r.shouldTrigger).toBe(true);
    expect(r.newState).toBe("below");
  });

  it("triggers when the price crosses above the target", () => {
    const r = evaluateAlert({
      targetMinor: 2500,
      direction: "above",
      currentMinor: 2600,
      priorState: "below",
      lastAlertedAt: null,
      now: NOW,
    });
    expect(r.shouldTrigger).toBe(true);
  });

  it("does NOT re-trigger while the price stays across the threshold", () => {
    const r = evaluateAlert({
      targetMinor: 2500,
      direction: "below",
      currentMinor: 2300,
      priorState: "below", // already below — no crossing
      lastAlertedAt: null,
      now: NOW,
    });
    expect(r.shouldTrigger).toBe(false);
  });

  it("ignores crossings in the wrong direction", () => {
    const r = evaluateAlert({
      targetMinor: 2500,
      direction: "below",
      currentMinor: 2600, // crossed UP, alert wants DOWN
      priorState: "below",
      lastAlertedAt: null,
      now: NOW,
    });
    expect(r.shouldTrigger).toBe(false);
    expect(r.newState).toBe("above"); // state still updates
  });

  it("applies the cooldown", () => {
    const base = {
      targetMinor: 2500,
      direction: "below" as const,
      currentMinor: 2400,
      priorState: "above" as const,
      now: NOW,
    };
    expect(
      evaluateAlert({ ...base, lastAlertedAt: NOW - ALERT_COOLDOWN_MS + 1000 }).shouldTrigger,
    ).toBe(false);
    expect(
      evaluateAlert({ ...base, lastAlertedAt: NOW - ALERT_COOLDOWN_MS - 1000 }).shouldTrigger,
    ).toBe(true);
  });

  it("handles unavailable prices gracefully (no state change, no alert)", () => {
    const r = evaluateAlert({
      targetMinor: 2500,
      direction: "below",
      currentMinor: null,
      priorState: "above",
      lastAlertedAt: null,
      now: NOW,
    });
    expect(r.shouldTrigger).toBe(false);
    expect(r.newState).toBeNull();
  });

  it("treats exactly-at-target as 'above' consistently", () => {
    const r = evaluateAlert({
      targetMinor: 2500,
      direction: "above",
      currentMinor: 2500,
      priorState: "below",
      lastAlertedAt: null,
      now: NOW,
    });
    expect(r.newState).toBe("above");
    expect(r.shouldTrigger).toBe(true);
  });
});
