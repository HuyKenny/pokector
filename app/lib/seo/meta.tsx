/**
 * SEO metadata builders (SPEC §23): unique titles/descriptions, canonical URLs,
 * Open Graph + Twitter cards, JSON-LD structured data, noindex helpers.
 */

import { LANG_TAGS, LOCALES, localePath } from "~/lib/i18n/locales";

export const SITE_NAME = "Pokector";
export const DEFAULT_OG_IMAGE = "/brand/pokector-og.png";

export interface PageMetaInput {
  title: string;
  description: string;
  /** Absolute canonical URL (use canonicalUrl()). */
  canonical?: string;
  image?: string;
  noindex?: boolean;
  type?: "website" | "article";
  /**
   * Site origin (env.APP_URL). When provided, `og:image`/`twitter:image` are
   * emitted as ABSOLUTE URLs (many crawlers, notably Facebook, reject relative
   * paths) and a page with no `image` falls back to the branded OG banner.
   * Also supplied implicitly by `alternates.appUrl` when that is set.
   */
  appUrl?: string;
  /**
   * When set, emit hreflang alternates for all locales + x-default. `path` is
   * the UNPREFIXED path (e.g. "/cards/base1-4"); each locale's alternate is
   * built with localePath(). Omit on noindex pages (hreflang must only point at
   * indexable URLs).
   */
  alternates?: { appUrl: string; path: string };
}

type MetaDescriptor = Record<string, string> | { title: string };

export function canonicalUrl(appUrl: string, path: string): string {
  const url = new URL(path, appUrl);
  url.search = ""; // parameter combinations are never canonical
  // Consistent no-trailing-slash policy (except root).
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

/**
 * Resolve a social-card image to an absolute URL against the site origin.
 * Already-absolute URLs (external card art) pass through unchanged; relative
 * `/brand/...` paths become absolute. Returns undefined when there's nothing to
 * resolve (no image and no origin to build the branded fallback from).
 */
function resolveOgImage(image: string | undefined, appUrl: string | undefined): string | undefined {
  const raw = image ?? (appUrl ? DEFAULT_OG_IMAGE : undefined);
  if (!raw) return undefined;
  if (/^https?:\/\//.test(raw)) return raw;
  return appUrl ? new URL(raw, appUrl).toString() : raw;
}

export function pageMeta(input: PageMetaInput): MetaDescriptor[] {
  const meta: MetaDescriptor[] = [
    { title: input.title },
    { name: "description", content: input.description },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:title", content: input.title },
    { property: "og:description", content: input.description },
    { property: "og:type", content: input.type ?? "website" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: input.title },
    { name: "twitter:description", content: input.description },
  ];
  if (input.canonical) {
    meta.push({ tagName: "link", rel: "canonical", href: input.canonical });
    meta.push({ property: "og:url", content: input.canonical });
  }
  const ogImage = resolveOgImage(input.image, input.appUrl ?? input.alternates?.appUrl);
  if (ogImage) {
    meta.push({ property: "og:image", content: ogImage });
    meta.push({ name: "twitter:image", content: ogImage });
  }
  if (input.noindex) {
    meta.push({ name: "robots", content: "noindex, nofollow" });
  } else if (input.alternates) {
    // Bidirectional hreflang: every locale (incl. English) lists all locales +
    // x-default. x-default points at the unprefixed English URL.
    const { appUrl, path } = input.alternates;
    for (const locale of LOCALES) {
      meta.push({
        tagName: "link",
        rel: "alternate",
        hreflang: LANG_TAGS[locale],
        href: canonicalUrl(appUrl, localePath(locale, path)),
      });
    }
    meta.push({
      tagName: "link",
      rel: "alternate",
      hreflang: "x-default",
      href: canonicalUrl(appUrl, path),
    });
  }
  return meta;
}

// ── Structured data ──────────────────────────────────────────────────────────

export interface BreadcrumbItem {
  name: string;
  path: string;
}

export function breadcrumbJsonLd(appUrl: string, items: BreadcrumbItem[]): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: canonicalUrl(appUrl, item.path),
    })),
  };
}

export function collectionPageJsonLd(
  appUrl: string,
  options: {
    name: string;
    description: string;
    path: string;
    items: { name: string; path: string }[];
  },
): object {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: options.name,
    description: options.description,
    url: canonicalUrl(appUrl, options.path),
    mainEntity: {
      "@type": "ItemList",
      itemListElement: options.items.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        url: canonicalUrl(appUrl, item.path),
      })),
    },
  };
}

/** schema.org money is a decimal string in major units. Minor → "12.34". */
function priceString(minor: number): string {
  return (minor / 100).toFixed(2);
}

export interface ProductJsonLdInput {
  appUrl: string;
  /** Product name, e.g. "Charizard (Base Set 4/102)". */
  name: string;
  /** Absolute image URL (external card art is already absolute). */
  image?: string;
  description?: string;
  /** Set name → brand. */
  brand?: string;
  /** Supertype, e.g. "Pokémon". */
  category?: string;
  /** Card number / stable id → SKU. */
  sku?: string;
  /** Canonical product URL. */
  url: string;
  /**
   * Market offers. Emit ONLY when the card is actually priced — no fabricated
   * $0. `lowPriceMinor`/`highPriceMinor` come from the active market's rows;
   * `offerUrl` is the affiliate "get this card" link when available.
   */
  offers: {
    lowPriceMinor: number;
    highPriceMinor: number;
    currency: string;
    offerCount: number;
    offerUrl?: string;
  };
}

/**
 * Product + AggregateOffer for a card detail page. Reflects real market
 * estimates (TCGplayer/Cardmarket) already shown on the page; no ratings or
 * availability are invented. Callers must skip this when the card is unpriced.
 */
export function productJsonLd(input: ProductJsonLdInput): object {
  const node: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.name,
    url: input.url,
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: input.offers.currency,
      lowPrice: priceString(input.offers.lowPriceMinor),
      highPrice: priceString(input.offers.highPriceMinor),
      offerCount: input.offers.offerCount,
      availability: "https://schema.org/InStock",
      url: input.offers.offerUrl ?? input.url,
    },
  };
  if (input.image) node.image = [input.image];
  if (input.description) node.description = input.description;
  if (input.sku) node.sku = input.sku;
  if (input.category) node.category = input.category;
  if (input.brand) node.brand = { "@type": "Brand", name: input.brand };
  return node;
}

/**
 * Standalone Organization entity (brand knowledge-graph anchor). `@id` lets the
 * WebSite node reference it as publisher. Render once, sitewide (home).
 */
export function organizationJsonLd(input: {
  appUrl: string;
  logo: string;
  sameAs?: string[];
}): object {
  const node: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${input.appUrl}#organization`,
    name: SITE_NAME,
    url: input.appUrl,
    logo: new URL(input.logo, input.appUrl).toString(),
  };
  if (input.sameAs && input.sameAs.length > 0) node.sameAs = input.sameAs;
  return node;
}

export interface FaqItem {
  question: string;
  answer: string;
}

/** FAQPage for landing pages with a genuine Q&A block on the page. */
export function faqPageJsonLd(items: FaqItem[]): object {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

export function JsonLd({ data }: { data: object | object[] }) {
  const payload = Array.isArray(data) ? data : [data];
  return payload.map((entry, i) => (
    <script
      key={i}
      type="application/ld+json"
      // JSON-LD must be raw JSON; "<" is escaped to prevent script breakout.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(entry).replaceAll("<", "\\u003c") }}
    />
  ));
}
