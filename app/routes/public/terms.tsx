import type { Route } from "./+types/terms";
import { getCloudflare } from "~/lib/context";
import { canonicalUrl, pageMeta } from "~/lib/seo/meta";

export function meta({ loaderData: data }: Route.MetaArgs) {
  return pageMeta({
    title: "Terms of Service | Pokector",
    description: "The terms that govern your use of Pokector.",
    canonical: data?.canonical,
  });
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" };
}

export function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  return {
    canonical: canonicalUrl(env.APP_URL, "/terms"),
    operatorName: env.LEGAL_OPERATOR_NAME,
    operatorAddress: env.LEGAL_OPERATOR_ADDRESS,
    operatorId: env.LEGAL_OPERATOR_ID,
    contactEmail: env.LEGAL_CONTACT_EMAIL,
  };
}

// NOTE FOR OPERATOR: template prepared for legal review before public launch.
export default function Terms({ loaderData }: Route.ComponentProps) {
  const { operatorName, operatorAddress, operatorId, contactEmail } = loaderData;
  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-5 text-sm leading-relaxed text-fg-muted">
      <h1 className="text-3xl font-bold text-fg">Terms of Service</h1>
      <p className="text-xs text-fg-faint">Last updated: July 17, 2026</p>

      <H2>1. The service</H2>
      <p>
        Pokector is a web application for tracking personal Pokémon TCG card collections, operated
        by {operatorName}, {operatorAddress}, {operatorId} (“operator”). By creating an account or
        using the site you agree to these terms.
      </p>

      <H2>2. Accounts</H2>
      <p>
        You must provide accurate account information and keep your credentials confidential. You
        are responsible for activity under your account. You may delete your account at any time in
        Settings; deletion is permanent.
      </p>

      <H2>3. Acceptable use</H2>
      <ul className="list-disc pl-6">
        <li>No attempts to breach security, scrape at abusive rates, or disrupt the service.</li>
        <li>No unlawful, infringing, or harmful content in notes, names, or shared binders.</li>
        <li>
          Automated access is permitted only through documented interfaces and within published rate
          limits.
        </li>
      </ul>
      <p>We may suspend accounts that violate these rules, with notice where practicable.</p>

      <H2>4. Your content</H2>
      <p>
        Collection data you enter remains yours. You grant the operator the technical license needed
        to store, process, and display it to you (and to others only where you explicitly share it).
        Aggregated, non-identifying statistics may be derived from usage.
      </p>

      <H2>5. Prices and data — no warranty, no advice</H2>
      <p>
        Market prices, set values, and portfolio figures are estimates derived from third-party
        sources and may be inaccurate, delayed, or incomplete. They are provided for personal
        informational purposes only and are{" "}
        <strong>not financial, investment, or trading advice</strong>, and not an offer to buy or
        sell anything. See the Disclaimer and Methodology pages.
      </p>

      <H2>6. Availability and liability</H2>
      <p>
        The service is provided “as is”, free of charge, without warranty of availability or fitness
        for a particular purpose. To the maximum extent permitted by law, the operator's liability
        for damages arising from use of the service is excluded; mandatory statutory liability (e.g.
        for intentional harm) remains unaffected.
      </p>

      <H2>7. Intellectual property</H2>
      <p>
        Pokector's own code, design, and text are the operator's property. Pokémon and Pokémon
        character names are trademarks of Nintendo; card images and catalog data belong to their
        respective owners and are displayed for identification purposes. Pokector is not affiliated
        with Nintendo, The Pokémon Company, Game Freak, Creatures, TCGplayer, or Cardmarket.
      </p>

      <H2>8. Changes and termination</H2>
      <p>
        We may update these terms or discontinue the service; material changes will be announced on
        the site in advance where reasonably possible. Continued use after a change means
        acceptance. You can end the agreement at any time by deleting your account.
      </p>

      <H2>9. Governing law</H2>
      <p>
        These terms are governed by the laws of the Czech Republic. Mandatory consumer protections
        of your country of residence remain unaffected. Contact:{" "}
        <a href={`mailto:${contactEmail}`} className="text-accent hover:underline">
          {contactEmail}
        </a>
        .
      </p>
    </article>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-2 text-lg font-semibold text-fg">{children}</h2>;
}
