import { Link } from "react-router";

import type { Route } from "./+types/grading";
import { StandaloneGradingCalculator } from "~/components/standalone-grading-calculator";
import { getCloudflare } from "~/lib/context";
import { getDict } from "~/lib/i18n/dictionaries.server";
import { LANG_TAGS, localePath, resolveLocale } from "~/lib/i18n/locales";
import { useLocalePath } from "~/lib/i18n/react";
import {
  breadcrumbJsonLd,
  canonicalUrl,
  faqPageJsonLd,
  JsonLd,
  pageMeta,
} from "~/lib/seo/meta";

export function meta({ loaderData: data }: Route.MetaArgs) {
  return pageMeta({
    title: data?.t.metaTitle ?? "Pokémon Card Grading Calculator | Pokector",
    description: data?.t.metaDescription ?? "",
    canonical: data?.canonical,
    alternates: data
      ? { appUrl: data.appUrl, path: "/pokemon-card-grading-calculator" }
      : undefined,
  });
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" };
}

export function loader({ params, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const locale = resolveLocale(params.locale);
  return {
    locale,
    t: getDict(locale).gradingLanding,
    c: getDict(locale).common,
    canonical: canonicalUrl(env.APP_URL, localePath(locale, "/pokemon-card-grading-calculator")),
    appUrl: env.APP_URL,
  };
}

export default function Grading({ loaderData }: Route.ComponentProps) {
  const { t, c, appUrl, locale } = loaderData;
  const lp = useLocalePath();
  const langTag = LANG_TAGS[locale];

  const steps = [
    { lead: t.how1Lead, body: t.how1Body },
    { lead: t.how2Lead, body: t.how2Body },
    { lead: t.how3Lead, body: t.how3Body },
  ];

  const faqs = [
    { question: t.faq1Q, answer: t.faq1A },
    { question: t.faq2Q, answer: t.faq2A },
    { question: t.faq3Q, answer: t.faq3A },
    { question: t.faq4Q, answer: t.faq4A },
  ];

  return (
    <div className="flex flex-col gap-12">
      <JsonLd
        data={[
          breadcrumbJsonLd(appUrl, [
            { name: c.home, path: lp("/") },
            { name: t.breadcrumb, path: lp("/pokemon-card-grading-calculator") },
          ]),
          faqPageJsonLd(faqs),
        ]}
      />

      <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
        <Link to={lp("/")} className="hover:text-fg">
          {c.home}
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page" className="text-fg">
          {t.breadcrumb}
        </span>
      </nav>

      {/* Hero + calculator */}
      <section className="flex flex-col gap-5">
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-fg sm:text-5xl">{t.h1}</h1>
        <p className="max-w-3xl text-lg text-fg-muted">{t.intro}</p>
        <StandaloneGradingCalculator
          langTag={langTag}
          labels={{
            tierLabel: t.tierLabel,
            tierValue: t.tierValue,
            tierRegular: t.tierRegular,
            tierExpress: t.tierExpress,
            rawLabel: t.rawLabel,
            psa9Label: t.psa9Label,
            psa10Label: t.psa10Label,
            colGrade: t.colGrade,
            colGradedValue: t.colGradedValue,
            colAllIn: t.colAllIn,
            colNet: t.colNet,
            colRoi: t.colRoi,
            feeNote: t.feeNote,
            disclaimer: t.disclaimer,
          }}
        />
      </section>

      {/* How it works */}
      <section aria-labelledby="how-heading">
        <h2 id="how-heading" className="mb-6 text-2xl font-bold text-fg">
          {t.howHeading}
        </h2>
        <div className="grid gap-6 text-sm text-fg-muted md:grid-cols-3">
          {steps.map((step) => (
            <p key={step.lead}>
              <strong className="text-fg">{step.lead}</strong>
              {step.body}
            </p>
          ))}
        </div>
      </section>

      {/* Try on a real card */}
      <section
        aria-labelledby="try-heading"
        className="rounded-(--radius-card) border border-edge bg-surface p-8"
      >
        <h2 id="try-heading" className="mb-3 text-2xl font-bold text-fg">
          {t.tryHeading}
        </h2>
        <p className="mb-4 max-w-3xl text-fg-muted">{t.tryBody}</p>
        <Link
          to={lp("/cards")}
          className="inline-block rounded-xl bg-accent px-6 py-3 font-medium text-(color:--color-on-accent) hover:bg-accent-strong"
        >
          {t.tryCta}
        </Link>
      </section>

      {/* FAQ */}
      <section aria-labelledby="faq-heading">
        <h2 id="faq-heading" className="mb-6 text-2xl font-bold text-fg">
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

      {/* CTA */}
      <section className="flex flex-col items-center gap-4 rounded-(--radius-card) bg-accent-soft p-10 text-center">
        <h2 className="text-2xl font-bold text-fg">{t.ctaHeading}</h2>
        <p className="max-w-xl text-fg-muted">{t.ctaBody}</p>
        <Link
          to={lp("/register")}
          className="rounded-xl bg-accent px-8 py-3 font-medium text-(color:--color-on-accent) hover:bg-accent-strong"
        >
          {t.ctaButton}
        </Link>
      </section>
    </div>
  );
}
