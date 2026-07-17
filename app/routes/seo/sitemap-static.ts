import type { Route } from "./+types/sitemap-static";
import { getCloudflare } from "~/lib/context";

const STATIC_PATHS = [
  "/",
  "/cards",
  "/sets",
  "/price-movers",
  "/methodology",
  "/about",
  "/blog",
  "/privacy",
  "/terms",
  "/disclaimer",
  "/contact",
];

export function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const urls = STATIC_PATHS.map(
    (path) => `<url><loc>${env.APP_URL}${path === "/" ? "" : path}</loc></url>`,
  );
  return new Response(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls,
      "</urlset>",
    ].join("\n"),
    {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, s-maxage=86400",
      },
    },
  );
}
