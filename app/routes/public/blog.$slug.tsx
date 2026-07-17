import { Link } from "react-router";

import type { Route } from "./+types/blog.$slug";
import { getBlogPost } from "~/lib/blog";
import { getCloudflare } from "~/lib/context";
import { breadcrumbJsonLd, canonicalUrl, JsonLd, pageMeta } from "~/lib/seo/meta";

export function meta({ loaderData: data }: Route.MetaArgs) {
  if (!data) {
    return pageMeta({
      title: "Article not found | Pokector",
      description: "Not found.",
      noindex: true,
    });
  }
  return pageMeta({
    title: `${data.post.title} | Pokector Blog`,
    description: data.post.description,
    canonical: data.canonical,
    type: "article",
  });
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" };
}

export function loader({ params, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const post = getBlogPost(params.slug);
  if (!post) throw new Response("Article not found", { status: 404 });
  return {
    post: { slug: post.slug, ...post.frontmatter },
    canonical: canonicalUrl(env.APP_URL, `/blog/${post.slug}`),
    appUrl: env.APP_URL,
  };
}

export default function BlogPost({ loaderData, params }: Route.ComponentProps) {
  const { post, appUrl } = loaderData;
  const entry = getBlogPost(params.slug);
  if (!entry) return null;
  const Article = entry.Component;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <JsonLd
        data={[
          breadcrumbJsonLd(appUrl, [
            { name: "Home", path: "/" },
            { name: "Blog", path: "/blog" },
            { name: post.title, path: `/blog/${post.slug}` },
          ]),
          {
            "@context": "https://schema.org",
            "@type": "Article",
            headline: post.title,
            description: post.description,
            datePublished: post.date,
            author: { "@type": "Organization", name: "Pokector" },
            publisher: { "@type": "Organization", name: "Pokector" },
            mainEntityOfPage: canonicalUrl(appUrl, `/blog/${post.slug}`),
          },
        ]}
      />
      <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
        <Link to="/" className="hover:text-fg">
          Home
        </Link>
        <span aria-hidden="true"> / </span>
        <Link to="/blog" className="hover:text-fg">
          Blog
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page" className="text-fg">
          {post.title}
        </span>
      </nav>

      <header>
        <p className="mb-2 text-xs uppercase tracking-wide text-accent">{post.category}</p>
        <h1 className="text-3xl font-bold leading-tight text-fg">{post.title}</h1>
        <p className="mt-2 text-sm text-fg-faint">
          <time dateTime={post.date}>{post.date}</time> · Pokector
        </p>
      </header>

      <div className="prose-blog">
        <Article />
      </div>

      <footer className="border-t border-edge pt-6">
        <p className="text-sm text-fg-muted">
          Track your own collection with honest market estimates —{" "}
          <Link to="/register" className="text-accent hover:underline">
            create a free Pokector account
          </Link>
          .
        </p>
      </footer>
    </div>
  );
}
