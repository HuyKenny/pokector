/**
 * Minimal Stripe client (no `stripe-node` SDK — it's heavy for Workers and we
 * only need a few calls). Raw `fetch` to the form-encoded Stripe REST API, the
 * same shape as the eBay token call. We use **hosted** Checkout + Customer Portal
 * (offsite redirects), so there is no Stripe.js, no publishable key, and no CSP
 * change. Webhook signatures are verified with WebCrypto HMAC-SHA256.
 *
 * Billing is optional: when `STRIPE_SECRET_KEY` is absent the pricing page still
 * renders but checkout/portal are unavailable (honest degraded mode).
 */

const STRIPE_API = "https://api.stripe.com/v1";
const STRIPE_API_VERSION = "2024-06-20";
/** Reject webhook events whose timestamp is older than this (replay defense). */
const SIGNATURE_TOLERANCE_SEC = 300;

export function stripeConfigured(env: Env): boolean {
  return typeof env.STRIPE_SECRET_KEY === "string" && env.STRIPE_SECRET_KEY.length > 0;
}

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "StripeError";
  }
}

/** Stringify a known-primitive leaf (never an object → no base-to-string risk). */
function primitiveToString(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/** Flatten a nested object into Stripe's `a[b][0][c]=v` form-encoding. */
function encodeForm(obj: Record<string, unknown>, prefix = ""): string[] {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        const itemKey = `${key}[${i}]`;
        if (item !== null && typeof item === "object") {
          parts.push(...encodeForm(item as Record<string, unknown>, itemKey));
        } else {
          parts.push(`${encodeURIComponent(itemKey)}=${encodeURIComponent(primitiveToString(item))}`);
        }
      });
    } else if (typeof v === "object") {
      parts.push(...encodeForm(v as Record<string, unknown>, key));
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(primitiveToString(v))}`);
    }
  }
  return parts;
}

async function stripeRequest<T>(
  env: Env,
  method: "GET" | "POST",
  path: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeError("Stripe is not configured", 500, false);

  const body = params ? encodeForm(params).join("&") : undefined;
  let lastError: StripeError | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${STRIPE_API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          "Stripe-Version": STRIPE_API_VERSION,
          ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      lastError = new StripeError("Stripe request failed (network/timeout)", 0, true);
      continue;
    }
    if (res.ok) return await res.json();

    const retryable = res.status === 429 || res.status >= 500;
    let detail = `Stripe ${res.status}`;
    try {
      const err: { error?: { message?: string } } = await res.json();
      if (err.error?.message) detail = err.error.message;
    } catch {
      /* non-JSON error body */
    }
    lastError = new StripeError(detail, res.status, retryable);
    if (!retryable) throw lastError;
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  throw lastError ?? new StripeError("Stripe request failed", 0, true);
}

// ── Checkout & Portal (hosted, offsite redirects) ────────────────────────────

export interface CheckoutParams {
  priceId: string;
  userId: string;
  successUrl: string;
  cancelUrl: string;
  /** Reuse an existing Stripe customer when known (avoids duplicates). */
  customerId?: string;
  /** Else Stripe creates a customer from this email. */
  customerEmail?: string;
}

/** Build the Checkout Session create params (pure — unit-testable without fetch). */
export function checkoutSessionParams(p: CheckoutParams): Record<string, unknown> {
  return {
    mode: "subscription",
    client_reference_id: p.userId,
    ...(p.customerId ? { customer: p.customerId } : { customer_email: p.customerEmail }),
    // Let the customer carry over to the subscription so the webhook can map it.
    "line_items[0][price]": p.priceId,
    "line_items[0][quantity]": 1,
    "subscription_data[metadata][userId]": p.userId,
    allow_promotion_codes: true,
    success_url: p.successUrl,
    cancel_url: p.cancelUrl,
  };
}

export async function createCheckoutSession(env: Env, p: CheckoutParams): Promise<{ url: string }> {
  const session = await stripeRequest<{ url: string | null }>(
    env,
    "POST",
    "/checkout/sessions",
    checkoutSessionParams(p),
  );
  if (!session.url) throw new StripeError("Checkout session has no URL", 502, false);
  return { url: session.url };
}

export async function createBillingPortalSession(
  env: Env,
  p: { customerId: string; returnUrl: string },
): Promise<{ url: string }> {
  const session = await stripeRequest<{ url: string }>(env, "POST", "/billing_portal/sessions", {
    customer: p.customerId,
    return_url: p.returnUrl,
  });
  return { url: session.url };
}

// ── Subscription reads (for the sync job) ────────────────────────────────────

export interface StripeSubscription {
  id: string;
  status: string;
  customer: string;
  current_period_end: number; // unix seconds
  cancel_at_period_end: boolean;
  items: { data: { price: { id: string; recurring?: { interval?: string } } }[] };
  metadata?: Record<string, string>;
}

export function getSubscription(env: Env, subscriptionId: string): Promise<StripeSubscription> {
  return stripeRequest<StripeSubscription>(env, "GET", `/subscriptions/${subscriptionId}`);
}

// ── Webhook signature verification (WebCrypto HMAC-SHA256) ────────────────────

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time compare of two equal-length hex strings. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

/**
 * Verify a Stripe webhook signature and return the parsed event. Throws on any
 * failure (bad signature, stale timestamp, malformed header) — the caller must
 * treat a throw as a 400. `nowSec` is injectable for tests.
 */
export async function constructStripeEvent(
  payload: string,
  sigHeader: string | null,
  webhookSecret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<StripeEvent> {
  if (!sigHeader) throw new StripeError("Missing Stripe-Signature header", 400, false);
  const parts = Object.fromEntries(
    sigHeader.split(",").map((kv) => {
      const idx = kv.indexOf("=");
      return [kv.slice(0, idx), kv.slice(idx + 1)];
    }),
  );
  const timestamp = Number(parts.t);
  const provided = parts.v1;
  if (!Number.isFinite(timestamp) || !provided) {
    throw new StripeError("Malformed Stripe-Signature", 400, false);
  }
  if (Math.abs(nowSec - timestamp) > SIGNATURE_TOLERANCE_SEC) {
    throw new StripeError("Stripe signature timestamp outside tolerance", 400, false);
  }
  const expected = await hmacSha256Hex(webhookSecret, `${timestamp}.${payload}`);
  if (!timingSafeEqual(expected, provided)) {
    throw new StripeError("Stripe signature mismatch", 400, false);
  }
  return JSON.parse(payload) as StripeEvent;
}
