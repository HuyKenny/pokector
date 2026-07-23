import type { Route } from "./+types/robots";
import { getCloudflare } from "~/lib/context";

/** Staging/dev must never be indexed (SPEC §23). */
export function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  // Fail-closed (Disallow: /) on anything that isn't production, so staging/
  // preview never get indexed. Normalize case/whitespace so a trivial env-var
  // typo ("Production", " production ") can't accidentally de-index the live site.
  const production = (env.ENVIRONMENT ?? "").trim().toLowerCase() === "production";

  const body = production
    ? [
        "User-agent: *",
        "Allow: /",
        "Disallow: /app/",
        "Disallow: /admin/",
        "Disallow: /api/",
        "Disallow: /login",
        "Disallow: /register",
        "Disallow: /forgot-password",
        "Disallow: /reset-password",
        "",
        `Sitemap: ${env.APP_URL}/sitemap.xml`,
        "",
      ].join("\n")
    : ["User-agent: *", "Disallow: /", ""].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600",
    },
  });
}
