import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { isPremium, planOf } from "~/lib/billing/entitlement.server";
import { checkoutSessionParams, constructStripeEvent } from "~/lib/billing/stripe.server";
import { limitsFor } from "~/lib/limits";

describe("entitlement", () => {
  it("is premium only while premiumUntil is in the future", () => {
    const now = 1_000_000;
    expect(isPremium({ premiumUntil: new Date(now + 1000) }, now)).toBe(true);
    expect(isPremium({ premiumUntil: new Date(now - 1000) }, now)).toBe(false);
    expect(isPremium({ premiumUntil: new Date(now) }, now)).toBe(false); // boundary: not >
    expect(isPremium({ premiumUntil: null }, now)).toBe(false);
    expect(isPremium(null, now)).toBe(false);
  });

  it("maps entitlement to a plan", () => {
    const now = 1_000_000;
    expect(planOf({ premiumUntil: new Date(now + 1) }, now)).toBe("pro");
    expect(planOf({ premiumUntil: new Date(now - 1) }, now)).toBe("free");
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

describe("checkoutSessionParams", () => {
  it("builds a subscription session tying the Stripe customer to our user", () => {
    const p = checkoutSessionParams({
      priceId: "price_123",
      userId: "user_abc",
      successUrl: "https://x/ok",
      cancelUrl: "https://x/no",
      customerEmail: "a@b.c",
    });
    expect(p.mode).toBe("subscription");
    expect(p.client_reference_id).toBe("user_abc");
    expect(p["line_items[0][price]"]).toBe("price_123");
    expect(p.customer_email).toBe("a@b.c");
    expect(p.customer).toBeUndefined();
  });

  it("reuses an existing customer id when known", () => {
    const p = checkoutSessionParams({
      priceId: "price_123",
      userId: "u",
      successUrl: "s",
      cancelUrl: "c",
      customerId: "cus_1",
    });
    expect(p.customer).toBe("cus_1");
    expect(p.customer_email).toBeUndefined();
  });
});

describe("constructStripeEvent (webhook signature)", () => {
  const secret = "whsec_test_secret";
  const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: {} });
  const sign = (body: string, t: number) =>
    createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");

  it("accepts a valid signature within tolerance", async () => {
    const t = 1_700_000_000;
    const header = `t=${t},v1=${sign(payload, t)}`;
    const event = await constructStripeEvent(payload, header, secret, t);
    expect(event.id).toBe("evt_1");
    expect(event.type).toBe("checkout.session.completed");
  });

  it("rejects a tampered payload", async () => {
    const t = 1_700_000_000;
    const header = `t=${t},v1=${sign(payload, t)}`;
    await expect(
      constructStripeEvent(payload + "x", header, secret, t),
    ).rejects.toThrow();
  });

  it("rejects a wrong secret", async () => {
    const t = 1_700_000_000;
    const header = `t=${t},v1=${createHmac("sha256", "nope").update(`${t}.${payload}`).digest("hex")}`;
    await expect(constructStripeEvent(payload, header, secret, t)).rejects.toThrow();
  });

  it("rejects a stale timestamp", async () => {
    const t = 1_700_000_000;
    const header = `t=${t},v1=${sign(payload, t)}`;
    // now is 10 minutes after the signature timestamp → outside the 5-min tolerance.
    await expect(constructStripeEvent(payload, header, secret, t + 600)).rejects.toThrow();
  });

  it("rejects a missing signature header", async () => {
    await expect(constructStripeEvent(payload, null, secret)).rejects.toThrow();
  });
});
