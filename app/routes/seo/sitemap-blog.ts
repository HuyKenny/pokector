import type { Route } from "./+types/sitemap-blog";
import { BLOG_POSTS } from "~/lib/blog";
import { getCloudflare } from "~/lib/context";

export function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const urls = BLOG_POSTS.map(
    (post) =>
      `<url><loc>${env.APP_URL}/blog/${post.slug}</loc><lastmod>${post.frontmatter.date}</lastmod></url>`,
  );
  return new Response(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      `<url><loc>${env.APP_URL}/blog</loc></url>`,
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
