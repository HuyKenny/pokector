/**
 * Parent route for the localized public tree (`/:locale/...`). Validates the
 * locale segment and renders an <Outlet> for the shared public layout + pages.
 *
 * - `/en/*` is never canonical (English lives at the root) → 301 strip the prefix.
 * - An unknown prefix (`/xx/cards`, or a single junk segment the `:locale` route
 *   greedily matched) → 404 via the ErrorBoundary below. Without this guard those
 *   URLs would render an empty localized shell instead of a proper 404.
 */
import { Link, Outlet, redirect } from "react-router";

import type { Route } from "./+types/locale-guard";
import { isLocale, stripLocalePrefix } from "~/lib/i18n/locales";

export function loader({ params, request }: Route.LoaderArgs) {
  if (params.locale === "en") {
    const url = new URL(request.url);
    throw redirect((stripLocalePrefix(url.pathname) || "/") + url.search, 301);
  }
  if (!isLocale(params.locale)) {
    throw new Response("Not Found", { status: 404 });
  }
  return null;
}

export default function LocaleGuard() {
  return <Outlet />;
}

/** 404 for invalid locale prefixes (e.g. /xx/cards). English copy — this only
 * fires on malformed URLs, never on a real localized page. */
export function ErrorBoundary() {
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
