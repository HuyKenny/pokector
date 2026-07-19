import type { Route } from "./+types/v1.price-movers";
import { apiJson } from "~/lib/api/respond";
import { getPriceMovers } from "~/lib/catalog/queries.server";
import { getCloudflare, getMarket, getRequestId } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { MARKET_CURRENCY } from "~/lib/market/market";

/** GET /api/v1/price-movers — real-history movers (never fabricated). Market
 * (us=TCGplayer/USD, eu=Cardmarket/EUR) follows the pk_market cookie. */
export async function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const requestId = getRequestId(context);
  const db = createDb(env.DB);
  const market = getMarket(context);
  const [up7, down7, up30, down30] = await Promise.all([
    getPriceMovers(db, 7, "up", 10, market),
    getPriceMovers(db, 7, "down", 10, market),
    getPriceMovers(db, 30, "up", 10, market),
    getPriceMovers(db, 30, "down", 10, market),
  ]);
  return apiJson(
    {
      data: {
        market,
        currency: MARKET_CURRENCY[market],
        sevenDay: { up: up7, down: down7 },
        thirtyDay: { up: up30, down: down30 },
      },
    },
    { headers: { "Cache-Control": "private, max-age=600, stale-while-revalidate=7200" } },
    requestId,
  );
}
