/**
 * Daily price-alert evaluation job (SPEC §13). For every enabled alert with a
 * target: read the current price of the alert's exact variant, evaluate the
 * crossing, persist the new threshold state, and on trigger create an in-app
 * notification (+ e-mail when a provider is configured) and a delivery record.
 */

import { eq, sql } from "drizzle-orm";

import { evaluateAlert, type ThresholdState } from "../../alerts/evaluate";
import { createDb, schema } from "../../db/index.server";
import { getEmailProvider } from "../../email/index.server";
import { formatMinor } from "../../money/decimal";
import { createNotification } from "../../notifications/queries.server";
import { addJobLog, type SyncJob } from "../queue.server";

export async function handleAlertsEvaluate(job: SyncJob, env: Env): Promise<void> {
  const db = createDb(env.DB);
  const emailProvider = getEmailProvider(env);
  const now = Date.now();

  const alerts = await db.all<{
    id: string;
    user_id: string;
    card_id: string;
    variant: string;
    currency: string;
    target_price_minor: number;
    alert_direction: ThresholdState;
    prior_threshold_state: ThresholdState | null;
    last_alerted_at: number | null;
    current_minor: number | null;
    card_name: string;
    card_slug: string;
    user_email: string;
  }>(sql`
    SELECT w.id, w.user_id, w.card_id, w.variant, w.currency, w.target_price_minor,
           w.alert_direction, w.prior_threshold_state, w.last_alerted_at,
           p.normalized_price_minor AS current_minor,
           k.name AS card_name, k.slug AS card_slug, u.email AS user_email
    FROM wishlist_items w
    JOIN pokemon_cards k ON k.id = w.card_id
    JOIN user u ON u.id = w.user_id
    LEFT JOIN card_prices_current p
      ON p.card_id = w.card_id AND p.variant = w.variant
     AND p.source = 'tcgplayer' AND p.currency = w.currency
    WHERE w.alert_enabled = 1 AND w.target_price_minor IS NOT NULL
    LIMIT 2000
  `);

  let triggered = 0;
  for (const alert of alerts) {
    const result = evaluateAlert({
      targetMinor: alert.target_price_minor,
      direction: alert.alert_direction,
      currentMinor: alert.current_minor,
      priorState: alert.prior_threshold_state,
      lastAlertedAt: alert.last_alerted_at,
      now,
    });

    if (result.newState === null) continue; // price unavailable — untouched

    if (!result.shouldTrigger) {
      await db
        .update(schema.wishlistItems)
        .set({ priorThresholdState: result.newState })
        .where(eq(schema.wishlistItems.id, alert.id));
      continue;
    }

    triggered++;
    const direction = alert.alert_direction === "below" ? "dropped below" : "rose above";
    const currency = alert.currency as "USD" | "EUR";
    const title = `${alert.card_name} ${direction} your target`;
    const message = `${alert.card_name} (${alert.variant}) is now ${formatMinor(
      alert.current_minor ?? 0,
      currency,
    )} — your target was ${formatMinor(alert.target_price_minor, currency)}.`;

    await createNotification(db, alert.user_id, {
      type: "price_alert",
      title,
      message,
      payload: { cardSlug: alert.card_slug, wishlistItemId: alert.id },
    });

    let deliveryEmail = false;
    let deliveryError: string | null = null;
    if (emailProvider) {
      const sent = await emailProvider.send({
        to: alert.user_email,
        subject: `${env.APP_NAME}: ${title}`,
        text: `${message}\n\nView the card: ${env.APP_URL}/cards/${alert.card_slug}\n\nManage alerts: ${env.APP_URL}/app/wishlist\n\n— ${env.APP_NAME}`,
      });
      deliveryEmail = sent.ok;
      if (!sent.ok) deliveryError = sent.error.slice(0, 300);
    }

    await db.insert(schema.priceAlertEvents).values({
      id: crypto.randomUUID(),
      wishlistItemId: alert.id,
      cardId: alert.card_id,
      userId: alert.user_id,
      priceMinor: alert.current_minor ?? 0,
      currency,
      deliveryInApp: true,
      deliveryEmail,
      deliveryError,
      triggeredAt: new Date(now),
    });
    await db
      .update(schema.wishlistItems)
      .set({ priorThresholdState: result.newState, lastAlertedAt: new Date(now) })
      .where(eq(schema.wishlistItems.id, alert.id));
  }

  await addJobLog(db, job.id, "info", "alerts.evaluated", {
    total: alerts.length,
    triggered,
    emailConfigured: emailProvider !== null,
  });
}
