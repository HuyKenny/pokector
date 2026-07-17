import { redirect } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/collection-quick-add";
import { getSession } from "~/lib/auth/auth.server";
import { getCloudflare } from "~/lib/context";
import { createDb, schema } from "~/lib/db/index.server";
import { bumpTrackedCounts } from "~/lib/collection/tracked.server";
import { enforceRateLimit } from "~/lib/security/rate-limit.server";
import { eq } from "drizzle-orm";

const BodySchema = z.object({ cardId: z.string().min(1).max(64) });

/** One-click "Add to collection" from public card pages (quantity 1, best variant). */
export async function action({ request, context }: Route.ActionArgs) {
  const { env } = getCloudflare(context);
  const session = await getSession(env, request);
  if (!session) {
    const referer = request.headers.get("referer");
    const returnTo = referer ? new URL(referer).pathname : "/cards";
    return redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  await enforceRateLimit(env.KV, "apiWrite", session.user.id);

  const parsed = BodySchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return { ok: false, message: "Invalid card." };

  const db = createDb(env.DB);
  const card = await db.query.pokemonCards.findFirst({
    where: eq(schema.pokemonCards.id, parsed.data.cardId),
    columns: { id: true, name: true },
  });
  if (!card) return { ok: false, message: "Card not found." };

  // Default variant = the card's cheapest priced variant, else "normal".
  const price = await db.query.cardPricesCurrent.findFirst({
    where: eq(schema.cardPricesCurrent.cardId, card.id),
    columns: { variant: true },
  });

  await db.insert(schema.collectionEntries).values({
    id: crypto.randomUUID(),
    userId: session.user.id,
    cardId: card.id,
    quantity: 1,
    variant: price?.variant ?? "normal",
  });
  await bumpTrackedCounts(db, card.id, { collection: 1 });

  return { ok: true, message: `${card.name} added to your collection.` };
}
