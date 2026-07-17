import type { Route } from "./+types/v1.cards";
import { apiJson } from "~/lib/api/respond";
import { searchCards } from "~/lib/catalog/queries.server";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { getRequestId } from "~/lib/context";
import { clientIp, enforceRateLimit } from "~/lib/security/rate-limit.server";

/** GET /api/v1/cards — paginated catalog search (D1-backed, cacheable). */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const requestId = getRequestId(context);
  const url = new URL(request.url);
  if (url.searchParams.get("q"))
    await enforceRateLimit(createDb(env.DB), "search", clientIp(request));

  const db = createDb(env.DB);
  const result = await searchCards(db, {
    q: url.searchParams.get("q") ?? undefined,
    setId: url.searchParams.get("set") ?? undefined,
    rarity: url.searchParams.get("rarity") ?? undefined,
    sort: (url.searchParams.get("sort") as "name" | "number" | "newest" | null) ?? undefined,
    page: Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
  });
  return apiJson(
    {
      data: result.items,
      page: result.page,
      pageCount: result.pageCount,
      total: result.total,
    },
    {},
    requestId,
  );
}
