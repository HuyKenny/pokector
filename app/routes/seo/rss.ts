import type { Route } from "./+types/rss";
import { BLOG_POSTS } from "~/lib/blog";
import { getCloudflare } from "~/lib/context";

const escapeXml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const items = BLOG_POSTS.map((post) => {
    const url = `${env.APP_URL}/blog/${post.slug}`;
    return [
      "<item>",
      `<title>${escapeXml(post.frontmatter.title)}</title>`,
      `<link>${url}</link>`,
      `<guid isPermaLink="true">${url}</guid>`,
      `<pubDate>${new Date(`${post.frontmatter.date}T09:00:00Z`).toUTCString()}</pubDate>`,
      `<category>${escapeXml(post.frontmatter.category)}</category>`,
      `<description>${escapeXml(post.frontmatter.description)}</description>`,
      "</item>",
    ].join("");
  });

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "<channel>",
    "<title>Pokector Blog</title>",
    `<link>${env.APP_URL}/blog</link>`,
    "<description>Practical guides for Pokémon TCG collectors — tracking, prices, binders, and set completion.</description>",
    "<language>en-us</language>",
    ...items,
    "</channel>",
    "</rss>",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=86400",
    },
  });
}
