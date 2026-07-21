import { Form, Link } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/wishlist";
import { Alert, Button, Card } from "~/components/ui";
import { requireUser } from "~/lib/auth/guards.server";
import { getCloudflare, getMarket } from "~/lib/context";
import { createDb, schema } from "~/lib/db/index.server";
import { addEntry } from "~/lib/collection/queries.server";
import { bumpTrackedCounts } from "~/lib/collection/tracked.server";
import { formatMinor, toMinorUnits } from "~/lib/money/decimal";
import { enforceRateLimit } from "~/lib/security/rate-limit.server";
import { and, count, eq, sql } from "drizzle-orm";
import { getUserPlan } from "~/lib/billing/entitlement.server";
import { limitsFor } from "~/lib/limits";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Wishlist & Alerts — Pokector" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);

  const items = await db.all<{
    id: string;
    card_id: string;
    card_name: string;
    card_slug: string;
    image_small_url: string | null;
    set_name: string;
    variant: string;
    currency: "USD" | "EUR";
    target_price_minor: number | null;
    alert_direction: "below" | "above";
    alert_enabled: number;
    last_alerted_at: number | null;
    current_minor: number | null;
  }>(sql`
    SELECT w.id, w.card_id, k.name AS card_name, k.slug AS card_slug, k.image_small_url,
           s.name AS set_name, w.variant, w.currency, w.target_price_minor,
           w.alert_direction, w.alert_enabled, w.last_alerted_at,
           p.normalized_price_minor AS current_minor
    FROM wishlist_items w
    JOIN pokemon_cards k ON k.id = w.card_id
    JOIN pokemon_sets s ON s.id = k.set_id
    LEFT JOIN card_prices_current p
      ON p.card_id = w.card_id AND p.variant = w.variant
     AND p.source = CASE WHEN w.currency = 'EUR' THEN 'cardmarket' ELSE 'tcgplayer' END
     AND p.currency = w.currency
    WHERE w.user_id = ${session.user.id}
    ORDER BY w.created_at DESC
    LIMIT 500
  `);

  return { items };
}

const ActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("configure"),
    itemId: z.string().uuid(),
    targetPrice: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : toMinorUnits(v)))
      .refine((v) => v === null || (v > 0 && v <= 100_000_000), "Invalid target price."),
    currency: z.enum(["USD", "EUR"]),
    direction: z.enum(["below", "above"]),
    enabled: z.string().optional(),
  }),
  z.object({ intent: z.literal("remove"), itemId: z.string().uuid() }),
  z.object({ intent: z.literal("to-collection"), itemId: z.string().uuid() }),
]);

export async function action({ request, context }: Route.ActionArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  await enforceRateLimit(createDb(env.DB), "alertConfig", session.user.id);
  const db = createDb(env.DB);
  const userId = session.user.id;

  const parsed = ActionSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) {
    return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const input = parsed.data;

  const owned = await db.query.wishlistItems.findFirst({
    where: and(eq(schema.wishlistItems.id, input.itemId), eq(schema.wishlistItems.userId, userId)),
  });
  if (!owned) return { ok: false as const, message: "Wishlist item not found." };

  switch (input.intent) {
    case "configure": {
      const enabled = input.enabled === "1" && input.targetPrice !== null;
      // Meter active alerts by plan, but only on the off→on transition (editing an
      // already-enabled alert is always allowed, even for grandfathered users).
      if (enabled && !owned.alertEnabled) {
        const plan = await getUserPlan(db, userId);
        const [{ n }] = await db
          .select({ n: count() })
          .from(schema.wishlistItems)
          .where(
            and(
              eq(schema.wishlistItems.userId, userId),
              eq(schema.wishlistItems.alertEnabled, true),
            ),
          );
        if (n >= limitsFor(plan).maxActiveAlerts) {
          return {
            ok: false as const,
            message: "You've hit the free-plan alert limit — upgrade to Pro for unlimited alerts.",
          };
        }
      }
      await db
        .update(schema.wishlistItems)
        .set({
          targetPriceMinor: input.targetPrice,
          currency: input.currency,
          alertDirection: input.direction,
          alertEnabled: enabled,
          // Reset crossing state when the threshold (or currency) changes — the
          // next evaluation records the fresh side before any alert can fire.
          priorThresholdState: null,
        })
        .where(eq(schema.wishlistItems.id, owned.id));
      return {
        ok: true as const,
        message: enabled ? "Alert saved and enabled." : "Wishlist item saved (alert off).",
      };
    }
    case "remove": {
      await db.delete(schema.wishlistItems).where(eq(schema.wishlistItems.id, owned.id));
      await bumpTrackedCounts(db, owned.cardId, { wishlist: -1 });
      return { ok: true as const, message: "Removed from wishlist." };
    }
    case "to-collection": {
      await addEntry(
        db,
        userId,
        {
          cardId: owned.cardId,
          quantity: 1,
          variant: owned.variant,
          condition: "Near Mint",
          language: "English",
          purchasePriceMinor: null,
          purchaseDate: null,
          notes: null,
        },
        getMarket(context),
      );
      await db.delete(schema.wishlistItems).where(eq(schema.wishlistItems.id, owned.id));
      await bumpTrackedCounts(db, owned.cardId, { wishlist: -1 });
      return { ok: true as const, message: "Moved to your collection." };
    }
  }
}

export default function Wishlist({ loaderData, actionData }: Route.ComponentProps) {
  const { items } = loaderData;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-fg">Wishlist &amp; price alerts</h1>
      {actionData ? (
        <Alert tone={actionData.ok ? "success" : "error"}>{actionData.message}</Alert>
      ) : null}

      {items.length === 0 ? (
        <Card className="text-center">
          <p className="mb-1 text-lg font-medium text-fg">Your wishlist is empty</p>
          <p className="text-sm text-fg-muted">
            Add cards from the{" "}
            <Link to="/cards" className="text-accent hover:underline">
              catalog
            </Link>{" "}
            or from set checklists, then set a target price to get alerted on real price crossings.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((item) => (
            <li key={item.id}>
              <Card className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <Link to={`/cards/${item.card_slug}`} className="flex items-center gap-3 sm:w-64">
                  {item.image_small_url ? (
                    <img
                      src={item.image_small_url}
                      alt=""
                      loading="lazy"
                      className="h-16 w-12 rounded border border-edge object-cover"
                    />
                  ) : null}
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-fg">{item.card_name}</span>
                    <span className="block truncate text-xs text-fg-faint">
                      {item.set_name} · {item.variant}
                    </span>
                    <span className="text-sm text-fg-muted">
                      {item.current_minor !== null
                        ? formatMinor(item.current_minor, item.currency)
                        : "unpriced"}
                    </span>
                  </span>
                </Link>

                <Form method="post" className="flex flex-1 flex-wrap items-end gap-3">
                  <input type="hidden" name="intent" value="configure" />
                  <input type="hidden" name="itemId" value={item.id} />
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`target-${item.id}`} className="text-xs font-medium text-fg">
                      Target price
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        id={`target-${item.id}`}
                        name="targetPrice"
                        inputMode="decimal"
                        defaultValue={
                          item.target_price_minor !== null
                            ? (item.target_price_minor / 100).toFixed(2)
                            : ""
                        }
                        placeholder="e.g. 25.00"
                        className="min-h-10 w-28 rounded-lg border border-edge bg-surface px-2 text-sm text-fg"
                      />
                      <label htmlFor={`cur-${item.id}`} className="sr-only">
                        Currency
                      </label>
                      <select
                        id={`cur-${item.id}`}
                        name="currency"
                        defaultValue={item.currency}
                        className="min-h-10 rounded-lg border border-edge bg-surface px-2 text-sm text-fg"
                      >
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`dir-${item.id}`} className="text-xs font-medium text-fg">
                      Alert when price
                    </label>
                    <select
                      id={`dir-${item.id}`}
                      name="direction"
                      defaultValue={item.alert_direction}
                      className="min-h-10 rounded-lg border border-edge bg-surface px-2 text-sm text-fg"
                    >
                      <option value="below">falls below target</option>
                      <option value="above">rises above target</option>
                    </select>
                  </div>
                  <label className="flex min-h-10 items-center gap-2 text-sm text-fg">
                    <input
                      type="checkbox"
                      name="enabled"
                      value="1"
                      defaultChecked={item.alert_enabled === 1}
                    />
                    Alert enabled
                  </label>
                  <Button type="submit" variant="secondary">
                    Save
                  </Button>
                </Form>

                <div className="flex shrink-0 gap-2">
                  <Form method="post">
                    <input type="hidden" name="intent" value="to-collection" />
                    <input type="hidden" name="itemId" value={item.id} />
                    <Button type="submit" variant="secondary">
                      Got it → collection
                    </Button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="remove" />
                    <input type="hidden" name="itemId" value={item.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      aria-label={`Remove ${item.card_name} from wishlist`}
                    >
                      Remove
                    </Button>
                  </Form>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-fg-faint">
        Alerts fire only when a price actually crosses your target (at most once per day per item)
        and create an in-app notification. E-mail delivery applies only when an e-mail provider is
        configured.
      </p>
    </div>
  );
}
