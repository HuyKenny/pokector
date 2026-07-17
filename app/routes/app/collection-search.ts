import type { Route } from "./+types/collection-search";
import { requireUser } from "~/lib/auth/guards.server";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { searchCards } from "~/lib/catalog/queries.server";
import { availableVariants } from "~/lib/collection/queries.server";
import { enforceRateLimit } from "~/lib/security/rate-limit.server";

/** Catalog search for the add-card dialog (JSON, authenticated). */
export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  await enforceRateLimit(env.KV, "search", session.user.id);

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return { items: [] };

  const db = createDb(env.DB);
  const result = await searchCards(db, { q, page: 1 });
  const items = await Promise.all(
    result.items.slice(0, 8).map(async (card) => ({
      ...card,
      variants: await availableVariants(db, card.id),
    })),
  );
  return { items };
}
