import { describe, expect, it } from "vitest";

import { FREE, parseEntitlements, PLANS } from "~/lib/billing/autumn.server";
import { isPremium, planOf } from "~/lib/billing/entitlement.server";
import { limitsFor, PLAN_LIMITS } from "~/lib/limits";

describe("entitlement", () => {
  it("is premium only while premiumUntil is in the future", () => {
    const now = 1_000_000;
    expect(isPremium({ premiumUntil: new Date(now + 1) }, now)).toBe(true);
    expect(isPremium({ premiumUntil: new Date(now - 1) }, now)).toBe(false);
    expect(isPremium({ premiumUntil: null }, now)).toBe(false);
    expect(isPremium(null, now)).toBe(false);
    expect(planOf({ premiumUntil: new Date(now + 1) }, now)).toBe("pro");
    expect(planOf(null, now)).toBe("free");
  });
});

describe("limitsFor", () => {
  it("gives free a metered tier and pro effectively-unlimited scale", () => {
    const free = limitsFor("free");
    const pro = limitsFor("pro");
    expect(free.maxBinders).toBe(3);
    expect(pro.maxBinders).toBeGreaterThan(free.maxBinders);
    expect(free.maxActiveAlerts).toBe(3);
    expect(pro.maxActiveAlerts).toBeGreaterThan(free.maxActiveAlerts);
  });
});

/**
 * The local FREE fallback must not drift from the `free` plan in
 * `autumn.config.ts` — if it does, an Autumn outage silently changes what a free
 * user is allowed to do.
 */
describe("FREE fallback", () => {
  it("mirrors the free tier limits and is not premium", () => {
    expect(FREE.planId).toBe(PLANS.free);
    expect(FREE.premium).toBe(false);
    expect(FREE.limits).toEqual(PLAN_LIMITS.free);
    expect(FREE.periodEnd).toBeNull();
  });
});

describe("parseEntitlements", () => {
  const paidSub = {
    plan_id: PLANS.pro,
    status: "active",
    interval: "month",
    current_period_end: 1_800_000_000_000,
  };

  it("treats a customer with no subscriptions as free", () => {
    const ent = parseEntitlements({});
    expect(ent.planId).toBe(PLANS.free);
    expect(ent.premium).toBe(false);
    expect(ent.limits).toEqual(PLAN_LIMITS.free);
  });

  it("reads a paid plan, its period end and interval", () => {
    const ent = parseEntitlements({ subscriptions: [paidSub], stripe_id: "cus_1" });
    expect(ent.planId).toBe(PLANS.pro);
    expect(ent.premium).toBe(true);
    expect(ent.periodEnd).toBe(1_800_000_000_000);
    expect(ent.interval).toBe("month");
    expect(ent.hasStripeCustomer).toBe(true);
  });

  it("keeps access while Stripe retries a past_due payment", () => {
    const ent = parseEntitlements({
      subscriptions: [{ ...paidSub, status: "past_due" }],
    });
    expect(ent.premium).toBe(true);
  });

  it("drops to free once the subscription is no longer active", () => {
    const ent = parseEntitlements({ subscriptions: [{ ...paidSub, status: "canceled" }] });
    expect(ent.planId).toBe(PLANS.free);
    expect(ent.premium).toBe(false);
  });

  // The auto-enabled free tier runs alongside the purchased one; the paid plan
  // must win, or a forgotten default would silently downgrade a paying customer.
  it("prefers the purchased plan over the auto-enabled free tier", () => {
    const ent = parseEntitlements({
      subscriptions: [
        { plan_id: PLANS.free, status: "active", auto_enable: true },
        paidSub,
      ],
    });
    expect(ent.planId).toBe(PLANS.pro);
    expect(ent.premium).toBe(true);
  });

  it("ignores add-ons when deciding the tier", () => {
    const ent = parseEntitlements({
      subscriptions: [{ plan_id: "some_addon", status: "active", add_on: true }],
    });
    expect(ent.planId).toBe(PLANS.free);
  });

  it("flags a scheduled cancellation while the paid period runs", () => {
    const ent = parseEntitlements({
      subscriptions: [{ ...paidSub, canceled_at: 1_700_000_000_000 }],
    });
    expect(ent.premium).toBe(true);
    expect(ent.cancelPending).toBe(true);
  });

  // A broken sync must never push someone below the free tier: that would turn a
  // billing glitch into a silent feature shutdown.
  it("floors allowances at the free tier", () => {
    const ent = parseEntitlements({
      subscriptions: [paidSub],
      balances: { max_binders: { granted: 0 } },
    });
    expect(ent.limits.maxBinders).toBe(PLAN_LIMITS.free.maxBinders);
  });

  it("reads granted allowances above the floor", () => {
    const ent = parseEntitlements({
      subscriptions: [paidSub],
      balances: { max_binders: { granted: 100 } },
    });
    expect(ent.limits.maxBinders).toBe(100);
  });

  it("treats an unlimited balance as effectively unbounded", () => {
    const ent = parseEntitlements({
      subscriptions: [paidSub],
      balances: { max_pinned_sets: { unlimited: true } },
    });
    expect(ent.limits.maxPinnedSets).toBe(Number.MAX_SAFE_INTEGER);
  });
});
