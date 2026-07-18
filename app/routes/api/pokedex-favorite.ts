import { z } from "zod";

import type { Route } from "./+types/pokedex-favorite";
import { getSession } from "~/lib/auth/auth.server";
import { togglePokedexFavorite } from "~/lib/catalog/queries.server";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { enforceRateLimit } from "~/lib/security/rate-limit.server";

const BodySchema = z.object({ dex: z.coerce.number().int().min(1).max(2000) });

/** Toggle a Pokémon as favourite (star) from the Pokédex page. Auth required. */
export async function action({ request, context }: Route.ActionArgs) {
  const { env } = getCloudflare(context);
  const session = await getSession(env, request);
  if (!session) {
    return Response.json({ ok: false, signedIn: false }, { status: 401 });
  }
  const db = createDb(env.DB);
  await enforceRateLimit(db, "apiWrite", session.user.id);

  const parsed = BodySchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return Response.json({ ok: false, message: "Invalid Pokémon." }, { status: 400 });

  const favorited = await togglePokedexFavorite(db, session.user.id, parsed.data.dex);
  return Response.json({ ok: true, dex: parsed.data.dex, favorited });
}
