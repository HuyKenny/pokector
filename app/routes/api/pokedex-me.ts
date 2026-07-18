import type { Route } from "./+types/pokedex-me";
import { optionalUser } from "~/lib/auth/guards.server";
import { getUserPokedexOverlay } from "~/lib/catalog/queries.server";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";

/**
 * Per-user Pokédex overlay (owned counts + favourites). The Pokédex page itself
 * is public + edge-cached, so this personal data is fetched client-side from
 * here. Never cached (private, no-store). Returns {signedIn:false} for guests.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await optionalUser(context, request);
  const headers = { "Cache-Control": "private, no-store" };
  if (!session) {
    return Response.json({ signedIn: false }, { headers });
  }
  const { env } = getCloudflare(context);
  const overlay = await getUserPokedexOverlay(createDb(env.DB), session.user.id);
  return Response.json({ signedIn: true, ...overlay }, { headers });
}
