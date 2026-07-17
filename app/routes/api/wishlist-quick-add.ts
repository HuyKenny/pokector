import { redirect } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/wishlist-quick-add";
import { getSession } from "~/lib/auth/auth.server";
import { getCloudflare } from "~/lib/context";
import { createDb, schema } from "~/lib/db/index.server";
import { bumpTrackedCounts } from "~/lib/collection/tracked.server";
import { enforceRateLimit } from "~/lib/security/rate-limit.server";
import { eq } from "drizzle-orm";

const BodySchema = z.object({ cardId: z.string().min(1).max(64) });

/** One-click "Add to wishlist" from public card pages. */
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

  const price = await db.query.cardPricesCurrent.findFirst({
    where: eq(schema.cardPricesCurrent.cardId, card.id),
    columns: { variant: true },
  });

  try {
    await db.insert(schema.wishlistItems).values({
      id: crypto.randomUUID(),
      userId: session.user.id,
      cardId: card.id,
      variant: price?.variant ?? "normal",
      currency: "USD",
    });
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test([error.message, String(error.cause)].join(" "))) {
      return { ok: true, message: `${card.name} is already on your wishlist.` };
    }
    throw error;
  }
  await bumpTrackedCounts(db, card.id, { wishlist: 1 });

  return { ok: true, message: `${card.name} added to your wishlist.` };
}
