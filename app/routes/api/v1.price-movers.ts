import type { Route } from "./+types/v1.price-movers";
import { apiJson } from "~/lib/api/respond";
import { getPriceMoversBoth } from "~/lib/catalog/queries.server";
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
  const [w7, w30] = await Promise.all([
    getPriceMoversBoth(db, 7, 10, market),
    getPriceMoversBoth(db, 30, 10, market),
  ]);
  return apiJson(
    {
      data: {
        market,
        currency: MARKET_CURRENCY[market],
        sevenDay: { up: w7.up, down: w7.down },
        thirtyDay: { up: w30.up, down: w30.down },
      },
    },
    { headers: { "Cache-Control": "private, max-age=600, stale-while-revalidate=7200" } },
    requestId,
  );
}
