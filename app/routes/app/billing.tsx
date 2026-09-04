import { eq } from "drizzle-orm";
import { Form, Link, redirect } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/billing";
import { Alert, Button, Card } from "~/components/ui";
import { requireUser } from "~/lib/auth/guards.server";
import {
  autumnConfigured,
  billingPortalUrl,
  createCheckout,
  getEntitlements,
  PLANS,
  syncFromAutumn,
} from "~/lib/billing/autumn.server";
import { getCloudflare } from "~/lib/context";
import { createDb, schema } from "~/lib/db/index.server";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Subscription — Pokector" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const justPaid = new URL(request.url).searchParams.get("checkout") === "success";

  // Coming back from checkout, sync straight away: waiting for the mirror TTL
  // would show the customer "Free" on the page they land on after paying.
  let ent;
  if (justPaid && autumnConfigured(env)) {
    try {
      ent = await syncFromAutumn(db, env, session.user.id, session.user.email);
    } catch {
      /* fall through to the mirror read below */
    }
  }
  ent ??= await getEntitlements(db, env, session.user.id, session.user.email);

  return {
    premium: ent.premium,
    planId: ent.planId,
    interval: ent.interval,
    cancelPending: ent.cancelPending,
    periodEnd: ent.periodEnd ? new Date(ent.periodEnd).toISOString().slice(0, 10) : null,
    hasStripeCustomer: ent.hasStripeCustomer,
    billingConfigured: autumnConfigured(env),
    justPaid,
  };
}

const ActionSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("checkout"), interval: z.enum(["month", "year"]) }),
  z.object({ intent: z.literal("portal") }),
]);

export async function action({ request, context }: Route.ActionArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  if (!autumnConfigured(env)) return { error: "Billing is not configured yet." };

  const parsed = ActionSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return { error: "Invalid request." };

  const db = createDb(env.DB);

  if (parsed.data.intent === "portal") {
    const [profile] = await db
      .select({ stripeCustomerId: schema.userProfiles.stripeCustomerId })
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, session.user.id))
      .limit(1);
    if (!profile?.stripeCustomerId) return { error: "No subscription to manage." };
    const url = await billingPortalUrl(env, session.user.id, `${env.APP_URL}/app/billing`);
    if (!url) return { error: "Could not open the billing portal — please try again." };
    return redirect(url);
  }

  // Checkout: the yearly and monthly tiers are separate Autumn plans in the same
  // group, so switching swaps the plan instead of stacking allowances.
  const planId = parsed.data.interval === "year" ? PLANS.pro_yearly : PLANS.pro;
  try {
    const result = await createCheckout(db, env, session.user.id, planId, session.user.email);
    if (result.checkoutUrl) return redirect(result.checkoutUrl);
    if (result.alreadyActive) return { error: "You're already on this plan." };
    // No link and the plan was not running: Autumn created a subscription nobody
    // paid for. Never tell the customer the payment succeeded.
    return { error: "Checkout could not be started — please contact support." };
  } catch {
    return { error: "Checkout is temporarily unavailable — please try again." };
  }
}

export default function Billing({ loaderData, actionData }: Route.ComponentProps) {
  const {
    premium,
    planId,
    interval,
    cancelPending,
    periodEnd,
    hasStripeCustomer,
    billingConfigured,
    justPaid,
  } = loaderData;

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
      {justPaid && premium ? <Alert tone="success">Payment received — Pro is active.</Alert> : null}
      {!billingConfigured ? (
        <Alert tone="warning">Billing isn't configured in this environment yet.</Alert>
      ) : null}
      {cancelPending && periodEnd ? (
        <Alert tone="warning">
          Your subscription is set to cancel; Pro stays active until {periodEnd}.
        </Alert>
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
              <dt className="text-fg-muted">Plan</dt>
              <dd className="text-end text-fg">{planId}</dd>
              <dt className="text-fg-muted">Billing</dt>
              <dd className="text-end text-fg">
                {interval === "year" ? "Yearly" : interval === "month" ? "Monthly" : "—"}
              </dd>
              {periodEnd ? (
                <>
                  <dt className="text-fg-muted">{cancelPending ? "Ends" : "Renews"}</dt>
                  <dd className="text-end text-fg">{periodEnd}</dd>
                </>
              ) : null}
            </dl>
          ) : null}

          {premium && hasStripeCustomer ? (
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
                Upgrade to unlock unlimited binders, wishlist, price alerts, graded cards, and
                pinned sets.
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
