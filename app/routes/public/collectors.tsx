import { Link } from "react-router";

import type { Route } from "./+types/collectors";
import { getCloudflare } from "~/lib/context";
import { getDict } from "~/lib/i18n/dictionaries.server";
import { localePath, resolveLocale } from "~/lib/i18n/locales";
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
    title: data?.t.metaTitle ?? "Pokémon Card Collectors | Pokector",
    description: data?.t.metaDescription ?? "",
    canonical: data?.canonical,
    alternates: data ? { appUrl: data.appUrl, path: "/pokemon-card-collectors" } : undefined,
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
    t: getDict(locale).collectorsLanding,
    c: getDict(locale).common,
    canonical: canonicalUrl(env.APP_URL, localePath(locale, "/pokemon-card-collectors")),
    appUrl: env.APP_URL,
  };
}

export default function Collectors({ loaderData }: Route.ComponentProps) {
  const { t, c, appUrl } = loaderData;
  const lp = useLocalePath();

  const tools = [
    { title: t.tool1Title, body: t.tool1Body, to: lp("/register") },
    { title: t.tool2Title, body: t.tool2Body, to: lp("/price-movers") },
    { title: t.tool3Title, body: t.tool3Body, to: lp("/sets") },
    { title: t.tool4Title, body: t.tool4Body, to: lp("/pokemon-card-grading-calculator") },
    { title: t.tool5Title, body: t.tool5Body, to: lp("/cards/compare") },
    { title: t.tool6Title, body: t.tool6Body, to: lp("/register") },
  ];

  const faqs = [
    { question: t.faq1Q, answer: t.faq1A },
    { question: t.faq2Q, answer: t.faq2A },
    { question: t.faq3Q, answer: t.faq3A },
    { question: t.faq4Q, answer: t.faq4A },
    { question: t.faq5Q, answer: t.faq5A },
  ];

  return (
    <div className="flex flex-col gap-12">
      <JsonLd
        data={[
          breadcrumbJsonLd(appUrl, [
            { name: c.home, path: lp("/") },
            { name: t.breadcrumb, path: lp("/pokemon-card-collectors") },
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

      {/* Hero */}
      <section className="flex max-w-3xl flex-col gap-5">
        <h1 className="text-4xl font-bold tracking-tight text-fg sm:text-5xl">{t.h1}</h1>
        <p className="text-lg text-fg-muted">{t.intro}</p>
        <div className="flex flex-wrap gap-3">
          <Link
            to={lp("/register")}
            className="rounded-xl bg-accent px-6 py-3 font-medium text-(color:--color-on-accent) hover:bg-accent-strong"
          >
            {t.ctaButton}
          </Link>
          <Link
            to={lp("/cards")}
            className="rounded-xl border border-edge bg-surface px-6 py-3 font-medium text-fg hover:bg-surface-raised"
          >
            {t.browseCards}
          </Link>
        </div>
      </section>

      {/* Tools */}
      <section aria-labelledby="tools-heading">
        <h2 id="tools-heading" className="mb-6 text-2xl font-bold text-fg">
          {t.toolsHeading}
        </h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <Link
              key={tool.title}
              to={tool.to}
              className="group flex h-full flex-col gap-2 rounded-(--radius-card) border border-edge bg-surface p-6 hover:border-accent"
            >
              <h3 className="font-semibold text-fg">{tool.title}</h3>
              <p className="text-sm text-fg-muted">{tool.body}</p>
              <span className="mt-auto pt-2 text-sm font-medium text-accent group-hover:underline">
                {t.toolCta} →
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Why */}
      <section
        aria-labelledby="why-heading"
        className="rounded-(--radius-card) border border-edge bg-surface p-8"
      >
        <h2 id="why-heading" className="mb-3 text-2xl font-bold text-fg">
          {t.whyHeading}
        </h2>
        <p className="max-w-3xl text-fg-muted">{t.whyBody}</p>
      </section>

      {/* FAQ */}
      <section aria-labelledby="faq-heading">
        <h2 id="faq-heading" className="mb-6 text-2xl font-bold text-fg">
          {t.faqHeading}
        </h2>
        <dl className="flex flex-col gap-4">
          {faqs.map((faq) => (
            <div key={faq.question} className="rounded-(--radius-card) border border-edge bg-surface p-6">
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
