/**
 * Autumn billing webhook (delivered via Svix).
 *
 * Verifies the Svix signature, then acks fast and hands off to the job queue —
 * the entitlement write happens in the idempotent `autumn_sync` handler, deduped
 * by the Autumn event id. Intentionally unauthenticated (Autumn-initiated); the
 * signature IS the auth.
 *
 * Without this endpoint the mirror still self-heals within its 6h TTL; the
 * webhook is what makes a payment or cancellation land immediately.
 *
 * Configure the endpoint URL + signing secret in the Autumn dashboard, then set
 * the secret with `wrangler secret put AUTUMN_WEBHOOK_SECRET`.
 */
import type { Route } from "./+types/autumn-webhook";
import { svixHeaders, verifySvix } from "~/lib/billing/svix";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { enqueueJob, wakeUp } from "~/lib/jobs/queue.server";
import { log } from "~/lib/log.server";

interface AutumnEvent {
  id?: string;
  type?: string;
  data?: { customer_id?: string; entity_id?: string };
  /** Some Autumn events carry the customer at the top level instead of in `data`. */
  customer_id?: string;
}

/**
 * The customer id, wherever this event happens to carry it. Autumn is not
 * consistent: some events put `customer_id` at the top level, subscription
 * events nest it under `data`.
 */
function customerIdOf(event: AutumnEvent): string | undefined {
  return event.data?.customer_id ?? event.data?.entity_id ?? event.customer_id;
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = getCloudflare(context);

  if (!env.AUTUMN_WEBHOOK_SECRET) {
    // Fail closed. An unverified billing webhook is a way to grant yourself a
    // paid plan, so a missing secret must never mean "accept everything".
    log.error("autumn.webhook_secret_missing", {});
    return new Response("Billing webhook not configured", { status: 503 });
  }

  // The raw body, byte for byte: the signature covers the exact bytes sent, so it
  // must not be re-serialised from a parsed object.
  const body = await request.text();
  const verified = await verifySvix({
    secret: env.AUTUMN_WEBHOOK_SECRET,
    headers: svixHeaders(request.headers),
    body,
  });
  if (!verified.ok) {
    log.warn("autumn.webhook_rejected", { reason: verified.reason });
    return new Response("Invalid signature", { status: 401 });
  }

  let event: AutumnEvent;
  try {
    event = JSON.parse(body) as AutumnEvent;
  } catch {
    return new Response("Malformed body", { status: 400 });
  }
  if (!event.id || !event.type) return new Response("Missing id or type", { status: 400 });

  const customerId = customerIdOf(event);
  /*
   * No allowlist of event types, on purpose. Re-syncing only on one exact event
   * name couples us to a string in someone else's product: if Autumn renames it
   * or adds another event that also changes entitlements, an allowlist keeps
   * answering 200 while quietly applying nothing — invisible until a paying
   * customer is treated as free. Every event carrying a customer id is therefore
   * a *hint that this customer may have changed*; the sync then reads the
   * authoritative state from Autumn. Idempotent, and one read is the right price
   * for not depending on an event name.
   */
  if (!customerId) return new Response(null, { status: 200 });

  const db = createDb(env.DB);
  // Autumn customers are created with `id: <our user id>`, so the customer id IS
  // the user id — see createCheckout/getOrCreateCustomer in autumn.server.ts.
  await enqueueJob(db, {
    type: "autumn_sync",
    idempotencyKey: `autumn:${event.id}`,
    payload: { userId: customerId, eventType: event.type },
  });
  ctx.waitUntil(wakeUp(env, "autumn_webhook").catch(() => undefined));

  return new Response(null, { status: 200 });
}

/** A GET here is a misconfiguration; say so rather than rendering a route. */
export function loader() {
  return new Response("Method not allowed", { status: 405 });
}
