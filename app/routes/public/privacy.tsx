import type { Route } from "./+types/privacy";
import { getCloudflare } from "~/lib/context";
import { canonicalUrl, pageMeta } from "~/lib/seo/meta";

export function meta({ loaderData: data }: Route.MetaArgs) {
  return pageMeta({
    title: "Privacy Policy | Pokector",
    description: "How Pokector collects, uses, and protects your personal data.",
    canonical: data?.canonical,
  });
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" };
}

export function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  return {
    canonical: canonicalUrl(env.APP_URL, "/privacy"),
    operatorName: env.LEGAL_OPERATOR_NAME,
    operatorAddress: env.LEGAL_OPERATOR_ADDRESS,
    operatorId: env.LEGAL_OPERATOR_ID,
    contactEmail: env.LEGAL_CONTACT_EMAIL,
  };
}

// NOTE FOR OPERATOR: this policy is a template prepared for legal review before
// public launch. Review data-processing statements against the deployed reality.
export default function Privacy({ loaderData }: Route.ComponentProps) {
  const { operatorName, operatorAddress, operatorId, contactEmail } = loaderData;
  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-5 text-sm leading-relaxed text-fg-muted">
      <h1 className="text-3xl font-bold text-fg">Privacy Policy</h1>
      <p className="text-xs text-fg-faint">Last updated: July 17, 2026</p>

      <H2>1. Who we are</H2>
      <p>
        Pokector (“we”, “us”) is operated by {operatorName}, {operatorAddress}, {operatorId}. For
        any privacy matter, contact{" "}
        <a href={`mailto:${contactEmail}`} className="text-accent hover:underline">
          {contactEmail}
        </a>
        .
      </p>

      <H2>2. What data we collect</H2>
      <ul className="list-disc pl-6">
        <li>
          <strong>Account data:</strong> e-mail address, display name, and a password hash (we never
          store your password in readable form). If you sign in with Google, we receive your name,
          e-mail, and account identifier from Google.
        </li>
        <li>
          <strong>Collection data:</strong> the cards, quantities, conditions, purchase prices,
          dates, notes, binders, and wishlists you record. This data is private to your account
          unless you explicitly share a binder.
        </li>
        <li>
          <strong>Technical data:</strong> IP address, browser user-agent, and request metadata
          processed for security (rate limiting, abuse prevention, session management) and
          operational logging. Our infrastructure provider is Cloudflare, Inc.
        </li>
      </ul>

      <H2>3. What we use it for</H2>
      <ul className="list-disc pl-6">
        <li>Providing the service (authentication, storing and displaying your collection).</li>
        <li>
          Security: preventing abuse, brute-force protection, bot filtering (Cloudflare Turnstile).
        </li>
        <li>
          Transactional e-mail (verification, password reset, price alerts) — only when e-mail
          delivery is configured and, for alerts, only when you enable them.
        </li>
        <li>
          Aggregate, non-identifying statistics (e.g. how many collectors track a card) that improve
          public features such as price tracking coverage.
        </li>
      </ul>
      <p>
        We do not sell personal data and we do not use third-party advertising or marketing
        trackers.
      </p>

      <H2>4. Legal bases</H2>
      <p>
        We process account and collection data to perform our contract with you; technical and
        security data based on our legitimate interest in operating a safe service; and optional
        e-mails based on your consent, which you can withdraw at any time.
      </p>

      <H2>5. Storage and processors</H2>
      <p>
        Data is stored on Cloudflare's global infrastructure (Cloudflare, Inc., USA — D1 database,
        KV storage). When configured, transactional e-mail is delivered by Resend (Resend, Inc.,
        USA) and sign-in with Google is provided by Google LLC. These providers act as processors
        bound by their respective data-processing agreements.
      </p>

      <H2>6. Retention</H2>
      <p>
        Your data is kept while your account exists. Deleting your account permanently removes your
        profile, collection, binders, wishlists, and notifications. Security logs are short-lived
        and rotate automatically. Administrative audit records may be retained where legally
        required.
      </p>

      <H2>7. Your rights</H2>
      <p>
        You can access and export your data (Settings → export), correct it in the app, or delete
        your account entirely (Settings → delete account). Depending on your location, you may also
        have rights to restriction, objection, portability, and to lodge a complaint with a
        supervisory authority (in the Czech Republic: ÚOOÚ, uoou.gov.cz). To exercise any right,
        e-mail{" "}
        <a href={`mailto:${contactEmail}`} className="text-accent hover:underline">
          {contactEmail}
        </a>
        .
      </p>

      <H2>8. Cookies</H2>
      <p>
        Pokector uses only strictly necessary cookies: a session cookie for signing you in and a
        Turnstile challenge cookie for bot protection. There are no analytics or advertising
        cookies, so no cookie banner is required.
      </p>

      <H2>9. Changes</H2>
      <p>
        We will announce material changes to this policy on this page. The date above always
        reflects the current version.
      </p>
    </article>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-2 text-lg font-semibold text-fg">{children}</h2>;
}
