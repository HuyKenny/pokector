/**
 * SEO metadata builders (SPEC §23): unique titles/descriptions, canonical URLs,
 * Open Graph + Twitter cards, JSON-LD structured data, noindex helpers.
 */

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
  if (input.image) {
    meta.push({ property: "og:image", content: input.image });
    meta.push({ name: "twitter:image", content: input.image });
  }
  if (input.noindex) {
    meta.push({ name: "robots", content: "noindex, nofollow" });
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
