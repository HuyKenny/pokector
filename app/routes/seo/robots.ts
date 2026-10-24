import type { Route } from "./+types/robots";
import { getCloudflare } from "~/lib/context";

/** Staging/dev must never be indexed (SPEC §23). */
export function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  // Fail-closed (Disallow: /) on anything that isn't production, so staging/
  // preview never get indexed. Normalize case/whitespace so a trivial env-var
  // typo ("Production", " production ") can't accidentally de-index the live site.
  const production = (env.ENVIRONMENT ?? "").trim().toLowerCase() === "production";

  // Crawlers that bring no visitors but cost Worker requests/CPU (Workers Paid bill, Oct 2026).
  const blocked = [
    "SemrushBot",
    "DataForSeoBot",
    "MJ12bot",
    "AhrefsBot",
    "Reflectionbot",
    "ExaSearchBot",
    "Applebot",
    "Amazonbot",
    "Amzn-SearchBot",
    "YouBot",
  ].flatMap((ua) => [`User-agent: ${ua}`, "Disallow: /", ""]);
  // Search crawlers we keep, but throttled (Claude-SearchBot alone was ~200k requests/week).
  const throttled = ["Claude-SearchBot", "bingbot"].flatMap((ua) => [
    `User-agent: ${ua}`,
    "Crawl-delay: 10",
    "Disallow: /app/",
    "Disallow: /admin/",
    "Disallow: /api/",
    "",
  ]);

  const body = production
    ? [
        ...blocked,
        ...throttled,
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
