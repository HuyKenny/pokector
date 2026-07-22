import { redirect } from "react-router";

import type { Route } from "./+types/game";
import { GAME_COOKIE, gamePath, resolveGame } from "~/lib/game/game";

/** POST-only game switch. Mirrors /market (JS-free plain form post): persists the
 * chosen game in the `pk_game` cookie and redirects to that game's catalog. The
 * active game is URL-derived, so the cookie is just a remembered preference. */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const field = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" ? v : "";
  };
  const game = resolveGame(field("game"));
  // Land on that game's cards catalog; the switcher may pass a locale-prefixed
  // target, else fall back to the game's default landing.
  const redirectTo = safeRedirect(field("redirectTo") || gamePath(game, "/cards"));
  // 1 year, Lax so it survives normal navigation; not HttpOnly (no secret).
  const cookie = `${GAME_COOKIE}=${game}; Path=/; Max-Age=31536000; SameSite=Lax`;
  return redirect(redirectTo, { headers: { "Set-Cookie": cookie } });
}

export function loader() {
  return redirect("/");
}

/** Only allow a same-site path redirect (no protocol-relative or absolute URLs). */
function safeRedirect(to: string): string {
  return to.startsWith("/") && !to.startsWith("//") ? to : "/";
}
