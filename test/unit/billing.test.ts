import { describe, expect, it } from "vitest";

import {
  FREE,
  MIRROR_TTL_MS,
  parseEntitlements,
  PLANS,
  premiumUntilFor,
} from "~/lib/billing/autumn.server";
import { isPremium, planOf } from "~/lib/billing/entitlement.server";
import { limitsFor } from "~/lib/limits";

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
  it("is the free plan and not premium", () => {
    expect(FREE.planId).toBe(PLANS.free);
    expect(FREE.premium).toBe(false);
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


});

/**
 * The bug this guards: writing the epoch for a *premium* customer makes
 * `isPremium` false at every gate, so someone who paid is silently locked out of
 * what they bought. Autumn can report an active plan with no period end.
 */
describe("premiumUntilFor", () => {
  const base = { planId: PLANS.pro, premium: true, cancelPending: false, interval: "month" as const, hasStripeCustomer: true };

  it("mirrors the paid period end when Autumn sends one", () => {
    expect(premiumUntilFor({ ...base, periodEnd: 1_800_000_000_000 }).getTime()).toBe(1_800_000_000_000);
  });

  it("keeps a premium customer with no period end in access, not at the epoch", () => {
    const until = premiumUntilFor({ ...base, periodEnd: null });
    expect(until.getTime()).toBeGreaterThan(Date.now());
    // Only until the next sync can correct it — not an open-ended grant.
    expect(until.getTime()).toBeLessThanOrEqual(Date.now() + MIRROR_TTL_MS + 1000);
  });

  it("puts a non-premium customer in the past so isPremium goes false", () => {
    expect(premiumUntilFor({ ...base, premium: false, periodEnd: null }).getTime()).toBe(0);
    expect(premiumUntilFor({ ...base, premium: false, periodEnd: 1_800_000_000_000 }).getTime()).toBe(0);
  });
});

describe("interval", () => {
  const sub = (planId: string) => ({ subscriptions: [{ plan_id: planId, status: "active" }] });

  // Derived from the plan: Autumn carries the interval on the product price, not
  // on the subscription, so reading it there showed "Billing: —" for everyone.
  it("derives the billing interval from the plan id", () => {
    expect(parseEntitlements(sub(PLANS.pro)).interval).toBe("month");
    expect(parseEntitlements(sub(PLANS.pro_yearly)).interval).toBe("year");
    expect(parseEntitlements({}).interval).toBeNull();
  });
});
