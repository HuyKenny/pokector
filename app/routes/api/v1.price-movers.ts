import type { Route } from "./+types/v1.price-movers";
import { apiJson } from "~/lib/api/respond";
import { getPriceMovers } from "~/lib/catalog/queries.server";
import { getCloudflare, getRequestId } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";

/** GET /api/v1/price-movers — real-history movers (never fabricated). */
export async function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const requestId = getRequestId(context);
  const db = createDb(env.DB);
  const [up7, down7, up30, down30] = await Promise.all([
    getPriceMovers(db, 7, "up"),
    getPriceMovers(db, 7, "down"),
    getPriceMovers(db, 30, "up"),
    getPriceMovers(db, 30, "down"),
  ]);
  return apiJson(
    { data: { sevenDay: { up: up7, down: down7 }, thirtyDay: { up: up30, down: down30 } } },
    { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=7200" } },
    requestId,
  );
}
