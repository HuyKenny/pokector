import type { Route } from "./+types/contact";
import { getCloudflare } from "~/lib/context";
import { canonicalUrl, pageMeta } from "~/lib/seo/meta";

export function meta({ loaderData: data }: Route.MetaArgs) {
  return pageMeta({
    title: "Contact | Pokector",
    description: "How to reach the Pokector team for support, data questions, or legal matters.",
    canonical: data?.canonical,
    appUrl: data?.appUrl,
  });
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" };
}

export function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  return {
    canonical: canonicalUrl(env.APP_URL, "/contact"),
    appUrl: env.APP_URL,
    supportEmail: env.SUPPORT_EMAIL,
    operatorName: env.LEGAL_OPERATOR_NAME,
    operatorAddress: env.LEGAL_OPERATOR_ADDRESS,
    operatorId: env.LEGAL_OPERATOR_ID,
  };
}

export default function Contact({ loaderData }: Route.ComponentProps) {
  const { supportEmail, operatorName, operatorAddress, operatorId } = loaderData;
  return (
    <article className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-3xl font-bold text-fg">Contact</h1>
      <p className="text-fg-muted">
        Questions, bug reports, data corrections, or account issues — e-mail is the fastest way to
        reach us. We read everything.
      </p>
      <div className="rounded-(--radius-card) border border-edge bg-surface p-6">
        <h2 className="mb-2 font-semibold text-fg">Support &amp; general inquiries</h2>
        <p className="text-fg-muted">
          <a href={`mailto:${supportEmail}`} className="text-accent hover:underline">
            {supportEmail}
          </a>
        </p>
      </div>
      <div className="rounded-(--radius-card) border border-edge bg-surface p-6 text-sm">
        <h2 className="mb-2 font-semibold text-fg">Operator</h2>
        <p className="text-fg-muted">
          {operatorName}
          <br />
          {operatorAddress}
          <br />
          {operatorId}
        </p>
      </div>
      <p className="text-xs text-fg-faint">
        For security vulnerability reports, please see{" "}
        <a href="/.well-known/security.txt" className="text-accent hover:underline">
          security.txt
        </a>
        .
      </p>
    </article>
  );
}
