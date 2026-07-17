import type { Route } from "./+types/sets.$setSlug.export-missing";
import { requireUser } from "~/lib/auth/guards.server";
import { getSetBySlug } from "~/lib/catalog/queries.server";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { computeSetProgress } from "~/lib/sets/progress.server";
import { toCsvLine } from "~/lib/csv/escape";
import { enforceRateLimit } from "~/lib/security/rate-limit.server";

/**
 * Resource route: streams the user's missing cards for a set as CSV (SPEC §12).
 * Loader-only (no component), so returning a Response is the natural shape.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  await enforceRateLimit(createDb(env.DB), "export", session.user.id);

  const db = createDb(env.DB);
  const data = await getSetBySlug(db, params.setSlug);
  if (!data) throw new Response("Set not found", { status: 404 });

  const progress = await computeSetProgress(db, session.user.id, data.set.id);
  const ownedSet = new Set(progress.ownedCardIds);
  const missing = data.cards.filter((card) => !ownedSet.has(card.id));

  const lines = [
    toCsvLine([
      "pokector_card_id",
      "card_name",
      "set_id",
      "card_number",
      "rarity",
      "estimated_price_usd",
    ]),
    ...missing.map((card) =>
      toCsvLine([
        card.id,
        card.name,
        data.set.id,
        card.number,
        card.rarity ?? "",
        card.priceMinor !== null ? (card.priceMinor / 100).toFixed(2) : "",
      ]),
    ),
  ];

  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pokector-missing-${data.set.id}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
