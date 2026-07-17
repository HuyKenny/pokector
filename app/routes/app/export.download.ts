import type { Route } from "./+types/export.download";
import { requireUser } from "~/lib/auth/guards.server";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { streamCollectionCsv } from "~/lib/csv/export.server";
import { enforceRateLimit } from "~/lib/security/rate-limit.server";

/** Resource route: streams the collection CSV (loader-only, so a raw Response
 * is the correct shape). Filters carry over via query params. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  await enforceRateLimit(createDb(env.DB), "export", session.user.id);
  const db = createDb(env.DB);
  const url = new URL(request.url);
  return streamCollectionCsv(db, session.user.id, {
    setId: url.searchParams.get("set") ?? undefined,
    variant: url.searchParams.get("variant") ?? undefined,
    condition: url.searchParams.get("condition") ?? undefined,
  });
}
