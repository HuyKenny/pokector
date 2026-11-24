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
import { getCloudflare, nonceContext } from "./lib/context";
import { isRtl, LANG_TAGS, localeFromPathname } from "./lib/i18n/locales";
import { THEME_SCRIPT } from "./lib/theme";
import "./app.css";

/** Google Analytics 4 measurement ID. Injected only in production (see loader);
 * staging/dev never send hits, so their traffic stays out of the reports. */
const GA_MEASUREMENT_ID = "G-J83PLQ5017";

export const links: Route.LinksFunction = () => [
  // Warm the TLS connection to the card-image hosts before the first <img>
  // request — card art is the dominant above-the-fold asset on every page.
  { rel: "preconnect", href: "https://images.pokemontcg.io", crossOrigin: "anonymous" },
  { rel: "preconnect", href: "https://images.scrydex.com", crossOrigin: "anonymous" },
  { rel: "icon", href: "/brand/pokector-icon.svg", type: "image/svg+xml" },
  { rel: "apple-touch-icon", href: "/brand/pokector-icon-192.png" },
  { rel: "manifest", href: "/manifest.webmanifest" },
];

/** Expose the per-request CSP nonce to the document so inline scripts match,
 * plus the GA measurement ID (production only). */
export function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  return {
    nonce: context.get(nonceContext),
    gaId: env.ENVIRONMENT === "production" ? GA_MEASUREMENT_ID : null,
    // The nightly static build (scripts/static/static.py) renders pokector.com as plain files without the
    // React client: the page then needs /static-site.js for query-string pages and GET-only switchers.
    staticSite: env.STATIC_RUNNER === "1",
  };
}

/** localStorage key of the analytics choice ("1" granted, "0" denied; absent = not asked yet). */
const CONSENT_KEY = "pk_consent";

/** GA4 Consent Mode v2: analytics cookies stay off until the visitor agrees (same pattern as Kenny's other
 * sites). Runs before gtag's config, so the first hit already carries the consent state. */
const GA_CONSENT_DEFAULT = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}(function(){var g='denied';try{if(localStorage.getItem('${CONSENT_KEY}')==='1')g='granted';}catch(e){}gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:g,functionality_storage:'granted',security_storage:'granted',wait_for_update:500});})();`;

/** Banner wiring in plain JS: the frozen static site ships no React client, so no hydrated handlers. */
const CONSENT_SCRIPT = `(function(){var K='${CONSENT_KEY}',b=document.getElementById('pk-consent');if(!b)return;var v=null;try{v=localStorage.getItem(K);}catch(e){}if(v===null)b.hidden=false;b.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('[data-pk-consent]');if(!t)return;var yes=t.getAttribute('data-pk-consent')==='1';try{localStorage.setItem(K,yes?'1':'0');}catch(e){}if(window.gtag)gtag('consent','update',{analytics_storage:yes?'granted':'denied'});b.hidden=true;});})();`;

/** Cookie consent for GA4 — fixed bar at the bottom, hidden until the script finds no stored choice. */
function ConsentBanner({ nonce }: { nonce?: string }) {
  return (
    <>
      <div
        id="pk-consent"
        hidden
        role="dialog"
        aria-live="polite"
        aria-label="Analytics cookies"
        className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-2xl flex-wrap items-center gap-3 rounded-(--radius-card) border border-edge bg-surface p-4 text-sm text-fg shadow-(--shadow-card)"
      >
        <p className="min-w-52 flex-1 text-fg-muted">
          We use Google Analytics to see which pages help collectors. It sets cookies only if you
          agree.{" "}
          <a href="/privacy#cookies" className="text-accent hover:underline">
            Privacy
          </a>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            data-pk-consent="1"
            className="min-h-11 rounded-lg bg-accent px-4 font-medium text-(color:--color-on-accent) hover:bg-accent-strong"
          >
            Accept
          </button>
          <button
            type="button"
            data-pk-consent="0"
            className="min-h-11 rounded-lg border border-edge px-4 hover:bg-surface-raised"
          >
            Decline
          </button>
        </div>
      </div>
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: CONSENT_SCRIPT }} />
    </>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const nonce = data?.nonce;
  const gaId = data?.gaId;
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
        {/* Impact.com affiliate network site verification. Impact matches a
            `value` attribute (not the usual `content`); spread it so the
            non-standard meta attribute passes TS and renders verbatim. */}
        <meta
          name="impact-site-verification"
          {...{ value: "292d478d-48bb-436d-b314-60365b6206b8" }}
        />
        <Meta />
        <Links />
        {/* Pre-hydration theme selection; carries the CSP nonce. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {/* Google Analytics 4 (production only). The external gtag loader is
            allowed by the googletagmanager host in the CSP; the inline config
            carries the per-request nonce. */}
        {gaId ? (
          <>
            <link rel="preconnect" href="https://www.googletagmanager.com" />
            <script
              async
              nonce={nonce}
              src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
            />
            <script
              nonce={nonce}
              dangerouslySetInnerHTML={{
                __html: `${GA_CONSENT_DEFAULT}gtag('js',new Date());gtag('config','${gaId}');`,
              }}
            />
          </>
        ) : null}
      </head>
      <body className="min-h-screen bg-canvas font-sans text-fg antialiased">
        {children}
        {gaId ? <ConsentBanner nonce={nonce} /> : null}
        {data?.staticSite ? <script nonce={nonce} src="/static-site.js" defer /> : null}
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
