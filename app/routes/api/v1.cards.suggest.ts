import type { Route } from "./+types/v1.cards.suggest";
import { searchCards } from "~/lib/catalog/queries.server";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { clientIp, enforceRateLimit } from "~/lib/security/rate-limit.server";

export interface SuggestItem {
  slug: string;
  name: string;
  setName: string | null;
  number: string;
  rarity: string | null;
  imageSmallUrl: string | null;
}

/**
 * GET /api/v1/cards/suggest?q= — typeahead for the header search. Public,
 * rate-limited by IP, min 2 chars, top 8 FTS-ranked cards (JSON `{ items }`).
 */
export async function loader({ request, context }: Route.LoaderArgs): Promise<{ items: SuggestItem[] }> {
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return { items: [] };

  await enforceRateLimit(db, "search", clientIp(request));
  const result = await searchCards(db, { q, page: 1 });
  const items: SuggestItem[] = result.items.slice(0, 8).map((c) => ({
    slug: c.slug,
    name: c.name,
    setName: c.setName ?? null,
    number: c.number,
    rarity: c.rarity,
    imageSmallUrl: c.imageSmallUrl,
  }));
  return { items };
}
