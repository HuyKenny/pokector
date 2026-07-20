import { Link, useSearchParams } from "react-router";

import type { Route } from "./+types/blog";
import { BLOG_CATEGORIES, BLOG_PAGE_SIZE, BLOG_POSTS } from "~/lib/blog";
import { getCloudflare } from "~/lib/context";
import { canonicalUrl, pageMeta } from "~/lib/seo/meta";

export function meta({ loaderData: data }: Route.MetaArgs) {
  return pageMeta({
    title: "Collecting Guides & Market Notes — Pokector Blog",
    description:
      "Practical guides for Pokémon TCG collectors: tracking collections, understanding market prices, organizing binders, and completing sets.",
    canonical: data?.canonical,
    appUrl: data?.appUrl,
    noindex: Boolean(data?.filtered),
  });
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" };
}

export function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);

  const filtered = category
    ? BLOG_POSTS.filter((p) => p.frontmatter.category === category)
    : BLOG_POSTS;
  const pageCount = Math.max(1, Math.ceil(filtered.length / BLOG_PAGE_SIZE));
  const items = filtered
    .slice((page - 1) * BLOG_PAGE_SIZE, page * BLOG_PAGE_SIZE)
    .map((p) => ({ slug: p.slug, ...p.frontmatter }));

  return {
    items,
    page,
    pageCount,
    category,
    categories: BLOG_CATEGORIES,
    filtered: Boolean(category || page > 1),
    canonical: canonicalUrl(env.APP_URL, "/blog"),
    appUrl: env.APP_URL,
  };
}

export default function Blog({ loaderData }: Route.ComponentProps) {
  const { items, page, pageCount, category, categories } = loaderData;
  const [searchParams] = useSearchParams();

  function pageLink(nextPage: number): string {
    const next = new URLSearchParams(searchParams);
    if (nextPage <= 1) next.delete("page");
    else next.set("page", String(nextPage));
    const qs = next.toString();
    return qs ? `/blog?${qs}` : "/blog";
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
        <Link to="/" className="hover:text-fg">
          Home
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page" className="text-fg">
          Blog
        </span>
      </nav>

      <div>
        <h1 className="text-3xl font-bold text-fg">Collecting guides &amp; market notes</h1>
        <p className="mt-2 text-fg-muted">
          Practical, hype-free writing for Pokémon TCG collectors.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
        <Link
          to="/blog"
          aria-current={!category ? "true" : undefined}
          className={`min-h-9 rounded-full px-4 py-1.5 text-sm font-medium ${
            !category
              ? "bg-accent text-(color:--color-on-accent)"
              : "border border-edge text-fg-muted hover:text-fg"
          }`}
        >
          All
        </Link>
        {categories.map((cat) => (
          <Link
            key={cat}
            to={`/blog?category=${encodeURIComponent(cat)}`}
            aria-current={category === cat ? "true" : undefined}
            className={`min-h-9 rounded-full px-4 py-1.5 text-sm font-medium ${
              category === cat
                ? "bg-accent text-(color:--color-on-accent)"
                : "border border-edge text-fg-muted hover:text-fg"
            }`}
          >
            {cat}
          </Link>
        ))}
      </div>

      <ul className="flex flex-col gap-6">
        {items.map((post) => (
          <li key={post.slug}>
            <article className="rounded-(--radius-card) border border-edge bg-surface p-6 hover:border-accent">
              <p className="mb-1 text-xs uppercase tracking-wide text-accent">{post.category}</p>
              <h2 className="text-xl font-semibold text-fg">
                <Link to={`/blog/${post.slug}`} className="hover:text-accent">
                  {post.title}
                </Link>
              </h2>
              <p className="mt-2 text-sm text-fg-muted">{post.description}</p>
              <p className="mt-3 text-xs text-fg-faint">
                <time dateTime={post.date}>{post.date}</time>
              </p>
            </article>
          </li>
        ))}
      </ul>

      {pageCount > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-center gap-2">
          {page > 1 ? (
            <Link
              to={pageLink(page - 1)}
              className="rounded-lg border border-edge px-4 py-2 text-sm"
            >
              ← Newer
            </Link>
          ) : null}
          <span className="px-2 text-sm text-fg-muted">
            Page {page} / {pageCount}
          </span>
          {page < pageCount ? (
            <Link
              to={pageLink(page + 1)}
              className="rounded-lg border border-edge px-4 py-2 text-sm"
            >
              Older →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
