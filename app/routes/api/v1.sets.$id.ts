import type { Route } from "./+types/v1.sets.$id";
import { apiError, apiJson } from "~/lib/api/respond";
import { getSetBySlug } from "~/lib/catalog/queries.server";
import { getCloudflare, getRequestId } from "~/lib/context";
import { createDb, schema } from "~/lib/db/index.server";
import { eq } from "drizzle-orm";

/** GET /api/v1/sets/:id — set detail with card list (slug or external ID). */
export async function loader({ params, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const requestId = getRequestId(context);
  const db = createDb(env.DB);

  let slug = params.id;
  const byId = await db.query.pokemonSets.findFirst({
    where: eq(schema.pokemonSets.id, params.id),
    columns: { slug: true },
  });
  if (byId) slug = byId.slug;

  const data = await getSetBySlug(db, slug);
  if (!data) return apiError(404, "not_found", "Set not found.", requestId);

  return apiJson(
    {
      data: {
        set: data.set,
        estimatedValueMinor: data.estimatedValueMinor,
        pricedCount: data.pricedCount,
        cards: data.cards,
      },
    },
    {},
    requestId,
  );
}
