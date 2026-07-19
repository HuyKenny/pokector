import { redirect } from "react-router";

import type { Route } from "./+types/market";
import { MARKET_COOKIE, resolveMarket } from "~/lib/market/market";

/** POST-only market switch: persists the chosen price market in a cookie and
 * redirects back to the page the visitor came from. JS-free (plain form post). */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const field = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" ? v : "";
  };
  const market = resolveMarket(field("market"));
  const redirectTo = safeRedirect(field("redirectTo") || "/");
  // 1 year, Lax so it survives normal navigation; not HttpOnly (no secret).
  const cookie = `${MARKET_COOKIE}=${market}; Path=/; Max-Age=31536000; SameSite=Lax`;
  return redirect(redirectTo, { headers: { "Set-Cookie": cookie } });
}

export function loader() {
  return redirect("/");
}

/** Only allow same-site path redirects (no protocol-relative or absolute URLs). */
function safeRedirect(to: string): string {
  return to.startsWith("/") && !to.startsWith("//") ? to : "/";
}
