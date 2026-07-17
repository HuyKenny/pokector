import { Link, redirect } from "react-router";

import type { Route } from "./+types/catchall";
import { isLocale, stripLocalePrefix } from "~/lib/i18n/locales";

/** 404 for unmatched paths (SPEC §23). Intentionally removed content can throw
 * 410 from its own route; unknown URLs are honest 404s.
 *
 * A locale-prefixed path that isn't part of the localized tree — an English-only
 * page (`/de/terms`, `/de/blog/x`) or an app/admin path (`/de/app`) — 301s to
 * its unprefixed equivalent rather than 404ing, so a mistyped/copied localized
 * URL still lands somewhere sensible without creating duplicate content. */
export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const first = url.pathname.split("/")[1];
  if (isLocale(first)) {
    const stripped = stripLocalePrefix(url.pathname);
    if (stripped !== url.pathname) throw redirect(stripped + url.search, 301);
  }
  throw new Response("Not Found", { status: 404 });
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Page not found | Pokector" }, { name: "robots", content: "noindex" }];
}

export default function CatchAll() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="text-3xl font-bold text-fg">Page not found</h1>
      <p className="text-fg-muted">
        The page you are looking for does not exist or may have moved.
      </p>
      <Link
        to="/"
        className="rounded-lg bg-accent px-4 py-2 font-medium text-(color:--color-on-accent) hover:bg-accent-strong"
      >
        Back to homepage
      </Link>
    </main>
  );
}
