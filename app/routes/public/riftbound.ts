/**
 * `/riftbound` (and `/:locale/riftbound`) → the Riftbound catalog landing page.
 * Loader-only redirect route (no component), mirroring routes/market.ts &
 * routes/game.ts. Locale-aware so the localized bare path lands on the localized
 * cards page.
 */
import { redirect } from "react-router";

import type { Route } from "./+types/riftbound";
import { gamePath } from "~/lib/game/game";
import { localePath, resolveLocale } from "~/lib/i18n/locales";

export function loader({ params }: Route.LoaderArgs) {
  return redirect(localePath(resolveLocale(params.locale), gamePath("riftbound", "/cards")));
}
