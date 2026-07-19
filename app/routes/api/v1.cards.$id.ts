import type { Route } from "./+types/v1.cards.$id";
import { apiError, apiJson } from "~/lib/api/respond";
import { getCardBySlug, getCardPriceHistory } from "~/lib/catalog/queries.server";
import { getCloudflare, getMarket, getRequestId } from "~/lib/context";
import { createDb, schema } from "~/lib/db/index.server";
import { MARKET_SOURCE } from "~/lib/market/market";
import { eq } from "drizzle-orm";

/**
 * GET /api/v1/cards/:id — card detail. `:id` accepts a slug or the external
 * card ID. Supports sub-resources ?prices and ?history via the `include` param
 * to keep it to a single route file:
 *   /api/v1/cards/:id            → card + set + prices
 *   /api/v1/cards/:id?include=history → adds priceHistory
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const requestId = getRequestId(context);
  const db = createDb(env.DB);

  // Resolve by slug first, then by external ID.
  let slug = params.id;
  if (!slug.includes("-") || slug.split("-").length < 3) {
    const byId = await db.query.pokemonCards.findFirst({
      where: eq(schema.pokemonCards.id, params.id),
      columns: { slug: true },
    });
    if (byId) slug = byId.slug;
  }

  const detail = await getCardBySlug(db, slug);
  if (!detail) return apiError(404, "not_found", "Card not found.", requestId);

  const market = getMarket(context);
  const url = new URL(request.url);
  const include = url.searchParams.get("include");
  const history =
    include === "history"
      ? await getCardPriceHistory(db, detail.card.id, { source: MARKET_SOURCE[market] })
      : undefined;

  return apiJson(
    {
      data: {
        id: detail.card.id,
        slug: detail.card.slug,
        name: detail.card.name,
        number: detail.card.number,
        rarity: detail.card.rarity,
        artist: detail.card.artist,
        hp: detail.card.hp,
        types: detail.card.typesJson ? (JSON.parse(detail.card.typesJson) as string[]) : [],
        imageSmallUrl: detail.card.imageSmallUrl,
        imageLargeUrl: detail.card.imageLargeUrl,
        set: detail.set,
        prices: detail.prices,
        trackingSince: detail.trackingSince,
        ...(history ? { market, priceHistory: history } : {}),
      },
    },
    {},
    requestId,
  );
}
