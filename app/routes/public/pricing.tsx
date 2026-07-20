import { useState } from "react";
import { Form, Link } from "react-router";

import type { Route } from "./+types/pricing";
import { optionalUser } from "~/lib/auth/guards.server";
import { isPremium } from "~/lib/billing/entitlement.server";
import { getCloudflare } from "~/lib/context";
import { createDb, schema } from "~/lib/db/index.server";
import { getDict } from "~/lib/i18n/dictionaries.server";
import { localePath, resolveLocale } from "~/lib/i18n/locales";
import { useLocalePath } from "~/lib/i18n/react";
import { canonicalUrl, faqPageJsonLd, JsonLd, pageMeta } from "~/lib/seo/meta";
import { eq } from "drizzle-orm";

// USD amounts are the same across locales — the surrounding labels are translated.
const PRICE_MONTHLY = "$3.99";
const PRICE_YEARLY_PER_MONTH = "$3.33";
const PRICE_YEARLY_TOTAL = "$39.99";

export function meta({ loaderData: data }: Route.MetaArgs) {
  return pageMeta({
    title: data?.t.metaTitle ?? "Pokector Pro — Pricing",
    description: data?.t.metaDescription ?? "",
    canonical: data?.canonical,
    alternates: data ? { appUrl: data.appUrl, path: "/pricing" } : undefined,
  });
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" };
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const locale = resolveLocale(params.locale);
  const session = await optionalUser(context, request);
  let premium = false;
  if (session) {
    const profile = await createDb(env.DB).query.userProfiles.findFirst({
      where: eq(schema.userProfiles.userId, session.user.id),
      columns: { premiumUntil: true },
    });
    premium = isPremium(profile);
  }
  return {
    locale,
    signedIn: session !== null,
    premium,
    t: getDict(locale).pricing,
    canonical: canonicalUrl(env.APP_URL, localePath(locale, "/pricing")),
    appUrl: env.APP_URL,
  };
}

export default function Pricing({ loaderData }: Route.ComponentProps) {
  const { t, signedIn, premium } = loaderData;
  const lp = useLocalePath();
  const [yearly, setYearly] = useState(true);

  // Comparison rows: value is a string (shown as-is) or a boolean (✓ / –).
  const rows: { label: string; free: string | boolean; pro: string | boolean }[] = [
    { label: t.featCollection, free: true, pro: true },
    { label: t.featBinders, free: "3", pro: t.valUnlimited },
    { label: t.featWishlist, free: "100", pro: t.valUnlimited },
    { label: t.featAlerts, free: "3", pro: t.valUnlimited },
    { label: t.featGraded, free: "10", pro: t.valUnlimited },
    { label: t.featPinned, free: "1", pro: t.valUnlimited },
    { label: t.featHistory, free: t.val30days, pro: t.valFullHistory },
    { label: t.featChecklists, free: true, pro: true },
    { label: t.featExport, free: true, pro: true },
    { label: t.featGrading, free: true, pro: true },
    { label: t.featPnl, free: true, pro: true },
    { label: t.featBadge, free: false, pro: true },
  ];

  const faqs = [
    { question: t.faq1Q, answer: t.faq1A },
    { question: t.faq2Q, answer: t.faq2A },
    { question: t.faq3Q, answer: t.faq3A },
  ];

  const Mark = ({ on }: { on: boolean }) =>
    on ? (
      <span className="text-positive" aria-label="Yes">
        ✓
      </span>
    ) : (
      <span className="text-fg-faint" aria-label="No">
        –
      </span>
    );

  const cell = (v: string | boolean) =>
    typeof v === "boolean" ? <Mark on={v} /> : <span className="text-fg">{v}</span>;

  // Pro CTA target depends on auth state (mirrors the competitor's "create account first").
  const proCta = premium ? (
    <Link
      to="/app/billing"
      className="block rounded-xl bg-surface px-6 py-3 text-center font-medium text-fg ring-1 ring-edge hover:bg-surface-raised"
    >
      {t.ctaManage}
    </Link>
  ) : signedIn ? (
    <Form method="post" action="/app/billing">
      <input type="hidden" name="intent" value="checkout" />
      <input type="hidden" name="interval" value={yearly ? "year" : "month"} />
      <button
        type="submit"
        className="w-full rounded-xl bg-accent px-6 py-3 font-medium text-(color:--color-on-accent) hover:bg-accent-strong"
      >
        {t.ctaPro}
      </button>
    </Form>
  ) : (
    <Link
      to={lp("/register")}
      className="block rounded-xl bg-accent px-6 py-3 text-center font-medium text-(color:--color-on-accent) hover:bg-accent-strong"
    >
      {t.ctaSignIn}
    </Link>
  );

  return (
    <div className="flex flex-col gap-12">
      <JsonLd data={faqPageJsonLd(faqs)} />

      {/* Hero */}
      <section className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-fg sm:text-5xl">{t.h1}</h1>
        <p className="max-w-2xl text-lg text-fg-muted">{t.subtitle}</p>

        {/* Billing interval toggle */}
        <div
          role="group"
          aria-label={t.billingInterval}
          className="mt-2 inline-flex rounded-xl border border-edge bg-surface p-1"
        >
          <button
            type="button"
            aria-pressed={!yearly}
            onClick={() => setYearly(false)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium ${!yearly ? "bg-accent text-(color:--color-on-accent)" : "text-fg-muted"}`}
          >
            {t.billingMonthly}
          </button>
          <button
            type="button"
            aria-pressed={yearly}
            onClick={() => setYearly(true)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium ${yearly ? "bg-accent text-(color:--color-on-accent)" : "text-fg-muted"}`}
          >
            {t.billingYearly}{" "}
            <span className={yearly ? "text-(color:--color-on-accent)" : "text-positive"}>
              · {t.saveNote}
            </span>
          </button>
        </div>
      </section>

      {/* Plan cards */}
      <section className="mx-auto grid w-full max-w-3xl gap-6 sm:grid-cols-2">
        {/* Free */}
        <div className="flex flex-col gap-4 rounded-(--radius-card) border border-edge bg-surface p-6">
          <div>
            <h2 className="text-xl font-bold text-fg">{t.freeName}</h2>
            <p className="text-sm text-fg-muted">{t.freeTagline}</p>
          </div>
          <p className="text-3xl font-bold text-fg">{t.priceFree}</p>
          {signedIn ? (
            <span className="block rounded-xl bg-surface-raised px-6 py-3 text-center text-sm font-medium text-fg-muted">
              {premium ? t.freeName : t.ctaCurrent}
            </span>
          ) : (
            <Link
              to={lp("/register")}
              className="block rounded-xl border border-edge px-6 py-3 text-center font-medium text-fg hover:bg-surface-raised"
            >
              {t.ctaFree}
            </Link>
          )}
        </div>

        {/* Pro */}
        <div className="flex flex-col gap-4 rounded-(--radius-card) border-2 border-accent bg-surface p-6">
          <div>
            <h2 className="text-xl font-bold text-fg">{t.proName}</h2>
            <p className="text-sm text-fg-muted">{t.proTagline}</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-fg">
              {yearly ? PRICE_YEARLY_PER_MONTH : PRICE_MONTHLY}
              <span className="text-base font-normal text-fg-muted">{t.perMonth}</span>
            </p>
            <p className="text-xs text-fg-faint">
              {yearly ? `${PRICE_YEARLY_TOTAL} ${t.billedYearlyNote}` : t.billedMonthlyNote}
            </p>
          </div>
          {proCta}
        </div>
      </section>

      {/* Comparison */}
      <section aria-labelledby="compare-heading" className="mx-auto w-full max-w-3xl">
        <h2 id="compare-heading" className="mb-4 text-2xl font-bold text-fg">
          {t.comparisonHeading}
        </h2>
        <div className="overflow-x-auto rounded-(--radius-card) border border-edge">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge bg-surface text-fg-muted">
                <th scope="col" className="px-4 py-3 text-start font-medium">
                  {t.colFeature}
                </th>
                <th scope="col" className="px-4 py-3 text-center font-medium">
                  {t.freeName}
                </th>
                <th scope="col" className="px-4 py-3 text-center font-semibold text-accent">
                  {t.proName}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-edge/50 last:border-0">
                  <th scope="row" className="px-4 py-3 text-start font-normal text-fg">
                    {row.label}
                  </th>
                  <td className="px-4 py-3 text-center tabular-nums">{cell(row.free)}</td>
                  <td className="px-4 py-3 text-center tabular-nums">{cell(row.pro)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-fg-faint">{t.honestNote}</p>
      </section>

      {/* FAQ */}
      <section aria-labelledby="pricing-faq" className="mx-auto w-full max-w-3xl">
        <h2 id="pricing-faq" className="mb-6 text-2xl font-bold text-fg">
          {t.faqHeading}
        </h2>
        <dl className="flex flex-col gap-4">
          {faqs.map((faq) => (
            <div
              key={faq.question}
              className="rounded-(--radius-card) border border-edge bg-surface p-6"
            >
              <dt className="font-semibold text-fg">{faq.question}</dt>
              <dd className="mt-2 text-sm text-fg-muted">{faq.answer}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
