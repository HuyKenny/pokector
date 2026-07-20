/**
 * Stripe webhook. Verifies the signature (WebCrypto HMAC), then acks fast (200)
 * and hands off to the job queue — the heavy entitlement write happens in the
 * idempotent `subscription_sync` handler, deduped by the Stripe event id. This
 * route is intentionally unauthenticated (Stripe-initiated); the signature IS the
 * auth. Configure the endpoint + signing secret in the Stripe dashboard.
 */
import type { Route } from "./+types/stripe-webhook";
import { constructStripeEvent } from "~/lib/billing/stripe.server";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { enqueueJob, wakeUp } from "~/lib/jobs/queue.server";
import { log } from "~/lib/log.server";

const RELEVANT_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = getCloudflare(context);
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("Billing not configured", { status: 500 });

  // Stripe signs the exact raw bytes — read them before any parsing.
  const payload = await request.text();
  let event;
  try {
    event = await constructStripeEvent(payload, request.headers.get("stripe-signature"), secret);
  } catch (error) {
    log.warn("stripe.webhook_rejected", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return new Response("Invalid signature", { status: 400 });
  }

  if (!RELEVANT_EVENTS.has(event.type)) {
    return new Response(null, { status: 200 }); // ack + ignore unrelated events
  }

  const obj = event.data.object;
  const metadata = obj.metadata as Record<string, unknown> | undefined;
  let subscriptionId: string | undefined;
  let userId: string | undefined;
  if (event.type === "checkout.session.completed") {
    subscriptionId = asString(obj.subscription);
    userId = asString(obj.client_reference_id);
  } else if (event.type.startsWith("customer.subscription")) {
    subscriptionId = asString(obj.id);
    userId = asString(metadata?.userId);
  } else {
    subscriptionId = asString(obj.subscription); // invoice.*
  }
  const customerId = asString(obj.customer);

  const db = createDb(env.DB);
  await enqueueJob(db, {
    type: "subscription_sync",
    idempotencyKey: `stripe:${event.id}`,
    payload: { eventType: event.type, subscriptionId, customerId, userId },
  });
  ctx.waitUntil(wakeUp(env, "stripe_webhook").catch(() => undefined));

  return new Response(null, { status: 200 });
}
