import { eq } from "drizzle-orm";
import { Form, Link, redirect } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/billing";
import { Alert, Button, Card } from "~/components/ui";
import { requireUser } from "~/lib/auth/guards.server";
import {
  createBillingPortalSession,
  createCheckoutSession,
  stripeConfigured,
} from "~/lib/billing/stripe.server";
import { isPremium } from "~/lib/billing/entitlement.server";
import { getCloudflare } from "~/lib/context";
import { createDb, schema } from "~/lib/db/index.server";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Subscription — Pokector" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const profile = await db.query.userProfiles.findFirst({
    where: eq(schema.userProfiles.userId, session.user.id),
    columns: {
      plan: true,
      planStatus: true,
      planInterval: true,
      premiumUntil: true,
      stripeCustomerId: true,
    },
  });
  return {
    premium: isPremium(profile),
    planStatus: profile?.planStatus ?? null,
    planInterval: profile?.planInterval ?? null,
    premiumUntil: profile?.premiumUntil ? profile.premiumUntil.toISOString().slice(0, 10) : null,
    hasCustomer: Boolean(profile?.stripeCustomerId),
    billingConfigured: stripeConfigured(env),
  };
}

const ActionSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("checkout"), interval: z.enum(["month", "year"]) }),
  z.object({ intent: z.literal("portal") }),
]);

export async function action({ request, context }: Route.ActionArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  if (!stripeConfigured(env)) return { error: "Billing is not configured yet." };

  const parsed = ActionSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return { error: "Invalid request." };

  const db = createDb(env.DB);
  const profile = await db.query.userProfiles.findFirst({
    where: eq(schema.userProfiles.userId, session.user.id),
    columns: { stripeCustomerId: true },
  });

  if (parsed.data.intent === "portal") {
    if (!profile?.stripeCustomerId) return { error: "No subscription to manage." };
    const { url } = await createBillingPortalSession(env, {
      customerId: profile.stripeCustomerId,
      returnUrl: `${env.APP_URL}/app/billing`,
    });
    return redirect(url);
  }

  // Checkout
  const priceId =
    parsed.data.interval === "year" ? env.STRIPE_PRICE_YEARLY : env.STRIPE_PRICE_MONTHLY;
  const { url } = await createCheckoutSession(env, {
    priceId,
    userId: session.user.id,
    customerId: profile?.stripeCustomerId ?? undefined,
    customerEmail: session.user.email,
    successUrl: `${env.APP_URL}/app/billing?checkout=success`,
    cancelUrl: `${env.APP_URL}/pricing`,
  });
  return redirect(url);
}

export default function Billing({ loaderData, actionData }: Route.ComponentProps) {
  const { premium, planStatus, planInterval, premiumUntil, hasCustomer, billingConfigured } =
    loaderData;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-fg">Subscription</h1>
        <p className="mt-1 text-fg-muted">
          {premium
            ? "You're on Pokector Pro — thank you for supporting an independent tracker."
            : "You're on the free plan."}
        </p>
      </header>

      {actionData && "error" in actionData ? <Alert tone="error">{actionData.error}</Alert> : null}
      {!billingConfigured ? (
        <Alert tone="warning">Billing isn't configured in this environment yet.</Alert>
      ) : null}

      <Card>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-fg">Current plan</span>
            <span
              className={`rounded-full px-3 py-1 text-sm font-semibold ${
                premium ? "bg-accent-soft text-accent" : "bg-surface-raised text-fg-muted"
              }`}
            >
              {premium ? "Pokector Pro" : "Free"}
            </span>
          </div>
          {premium ? (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-fg-muted">Status</dt>
              <dd className="text-end text-fg">{planStatus ?? "active"}</dd>
              <dt className="text-fg-muted">Billing</dt>
              <dd className="text-end text-fg">
                {planInterval === "year" ? "Yearly" : planInterval === "month" ? "Monthly" : "—"}
              </dd>
              {premiumUntil ? (
                <>
                  <dt className="text-fg-muted">Renews / ends</dt>
                  <dd className="text-end text-fg">{premiumUntil}</dd>
                </>
              ) : null}
            </dl>
          ) : null}

          {premium && hasCustomer ? (
            <Form method="post">
              <input type="hidden" name="intent" value="portal" />
              <Button type="submit" disabled={!billingConfigured}>
                Manage subscription
              </Button>
              <p className="mt-2 text-xs text-fg-faint">
                Update your card, switch plan, or cancel via the secure Stripe portal.
              </p>
            </Form>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-fg-muted">
                Upgrade to unlock unlimited binders, wishlist, price alerts, graded cards, pinned
                sets, and your full portfolio history.
              </p>
              <div className="flex flex-wrap gap-3">
                <Form method="post">
                  <input type="hidden" name="intent" value="checkout" />
                  <input type="hidden" name="interval" value="year" />
                  <Button type="submit" disabled={!billingConfigured}>
                    Go Pro — yearly (best value)
                  </Button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="checkout" />
                  <input type="hidden" name="interval" value="month" />
                  <Button type="submit" variant="secondary" disabled={!billingConfigured}>
                    Go Pro — monthly
                  </Button>
                </Form>
              </div>
              <Link to="/pricing" className="text-sm text-accent hover:underline">
                Compare Free vs Pro →
              </Link>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
