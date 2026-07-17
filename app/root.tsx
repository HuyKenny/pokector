import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useRouteLoaderData,
} from "react-router";

import type { Route } from "./+types/root";
import { nonceContext } from "./lib/context";
import { isRtl, LANG_TAGS, localeFromPathname } from "./lib/i18n/locales";
import { THEME_SCRIPT } from "./lib/theme";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/brand/pokector-icon.svg", type: "image/svg+xml" },
  { rel: "apple-touch-icon", href: "/brand/pokector-icon-192.png" },
  { rel: "manifest", href: "/manifest.webmanifest" },
];

/** Expose the per-request CSP nonce to the document so inline scripts match. */
export function loader({ context }: Route.LoaderArgs) {
  return { nonce: context.get(nonceContext) };
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const nonce = data?.nonce;
  // Locale is derived from the URL's first segment (the root loader has no
  // params and doesn't revalidate on client navigation, so useLocation keeps
  // <html lang/dir> correct across in-app navigations too).
  const locale = localeFromPathname(useLocation().pathname);
  return (
    // suppressHydrationWarning: the pre-hydration theme script adds `.dark` to
    // <html> before React hydrates, so this one element's attributes may
    // legitimately differ from the server render.
    <html lang={LANG_TAGS[locale]} dir={isRtl(locale) ? "rtl" : "ltr"} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#fcfaf6" />
        <Meta />
        <Links />
        {/* Pre-hydration theme selection; carries the CSP nonce. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-canvas font-sans text-fg antialiased">
        {children}
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let details = "An unexpected error occurred. Please try again.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Page not found";
      details = "The page you are looking for does not exist or may have moved.";
    } else if (error.status === 410) {
      title = "Content removed";
      details = "This content has been permanently removed.";
    } else {
      title = `Error ${error.status}`;
      details = error.statusText || details;
    }
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="text-3xl font-bold text-fg">{title}</h1>
      <p className="text-fg-muted">{details}</p>
      <a
        href="/"
        className="rounded-lg bg-accent px-4 py-2 font-medium text-(color:--color-on-accent) hover:bg-accent-strong"
      >
        Back to homepage
      </a>
      {stack ? (
        <pre className="mt-6 w-full overflow-x-auto rounded-lg bg-surface-raised p-4 text-start text-xs">
          <code>{stack}</code>
        </pre>
      ) : null}
    </main>
  );
}
