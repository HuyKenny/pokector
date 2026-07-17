import type { Route } from "./+types/v1.sets";
import { apiJson } from "~/lib/api/respond";
import { listSets } from "~/lib/catalog/queries.server";
import { getCloudflare, getRequestId } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";

/** GET /api/v1/sets — paginated set catalog. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const requestId = getRequestId(context);
  const url = new URL(request.url);
  const db = createDb(env.DB);
  const result = await listSets(db, {
    series: url.searchParams.get("series") ?? undefined,
    sort: (url.searchParams.get("sort") as "release" | "name" | "cards" | null) ?? undefined,
    page: Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
  });
  return apiJson(
    { data: result.items, page: result.page, pageCount: result.pageCount, total: result.total },
    {},
    requestId,
  );
}
