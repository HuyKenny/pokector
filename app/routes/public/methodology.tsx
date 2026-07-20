import { Link } from "react-router";

import type { Route } from "./+types/methodology";
import { getCloudflare } from "~/lib/context";
import { canonicalUrl, pageMeta } from "~/lib/seo/meta";

export function meta({ loaderData: data }: Route.MetaArgs) {
  return pageMeta({
    title: "Data & Pricing Methodology | Pokector",
    description:
      "How Pokector sources catalog data, normalizes TCGplayer and Cardmarket prices, records price history, and calculates portfolio values — including all limitations.",
    canonical: data?.canonical,
    appUrl: data?.appUrl,
  });
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" };
}

export function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  return { canonical: canonicalUrl(env.APP_URL, "/methodology"), appUrl: env.APP_URL };
}

export default function Methodology() {
  return (
    <article className="prose-pokector mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-3xl font-bold text-fg">Data &amp; pricing methodology</h1>
      <p className="text-fg-muted">
        Pokector aims to be the most honest collection tracker you can use. This page explains
        exactly where our data comes from, how prices are calculated, and what the numbers can and
        cannot tell you.
      </p>

      <Section title="Data sources">
        <p>
          The card catalog (cards, sets, images, rarities) comes from the public Pokémon TCG API and
          covers English-language cards. Pokector keeps its own synchronized copy — searches and
          card pages are served from our database, refreshed daily.
        </p>
        <p>
          Prices come from two sources exposed by the same API: <strong>TCGplayer</strong> (USD, the
          primary valuation source, per printing variant) and <strong>Cardmarket</strong> (EUR,
          shown as a secondary reference). The two sources are never mixed into a single number and
          no currency conversion is applied.
        </p>
      </Section>

      <Section title="Price normalization">
        <p>For each card variant, the displayed USD estimate picks the first available of:</p>
        <ol className="list-decimal pl-6 text-fg-muted">
          <li>
            TCGplayer <strong>market</strong> price,
          </li>
          <li>
            otherwise the <strong>mid</strong> price,
          </li>
          <li>
            otherwise the <strong>low</strong> price.
          </li>
        </ol>
        <p>
          The EUR reference picks Cardmarket's <strong>trend</strong> price, then{" "}
          <strong>average sell</strong> price, then <strong>low</strong> price. All money is stored
          as integer cents — no floating-point rounding errors.
        </p>
      </Section>

      <Section title="Missing prices">
        <p>
          When a source publishes no price for a variant, that variant is <em>unpriced</em>. An
          unpriced card contributes nothing to totals and is clearly counted as unpriced — it is
          never silently valued at zero, and another variant's price is never substituted. You can
          always explicitly switch a collection entry to a different variant.
        </p>
      </Section>

      <Section title="Condition">
        <p>
          You can record each card's condition (Near Mint through Damaged), but condition{" "}
          <strong>does not automatically modify</strong> the displayed value. Market estimates
          describe raw, ungraded cards in typical near-mint market condition; a played copy will
          usually sell for less. We track condition as your metadata and leave the judgment to you
          rather than apply arbitrary multipliers.
        </p>
      </Section>

      <Section title="Price history">
        <p>
          History charts show only <strong>real observations recorded by Pokector</strong>, starting
          the day a card first became tracked (in someone's collection or wishlist, frequently
          viewed, or needed for the price-movers page). At most one observation per source, variant,
          currency, and calendar day is stored, and a new point is stored only when the value
          changed; charts carry the last known value forward between points. Nothing is backfilled
          and nothing is simulated. Daily points older than roughly 13 months are consolidated into
          monthly points.
        </p>
      </Section>

      <Section title="Portfolio values">
        <p>
          Your portfolio's market value is the sum of current normalized prices × quantities for
          your priced entries. Cost basis sums only the entries where you recorded a purchase price.
          Profit/loss and ROI are computed only over entries that have <em>both</em> a purchase
          price and a current market price — a missing purchase price is never treated as “bought
          for $0”. Coverage percentages on your dashboard show exactly how much of your collection
          each number describes. Portfolio history starts the day you start tracking; earlier dates
          are never generated.
        </p>
      </Section>

      <Section title="Currency">
        <p>
          The default portfolio currency is USD using TCGplayer prices. Cardmarket EUR values are
          shown separately for reference and are never converted or merged.
        </p>
      </Section>

      <Section title="Limitations">
        <ul className="list-disc pl-6 text-fg-muted">
          <li>Estimates are indicative market prices, not offers to buy or sell.</li>
          <li>
            Graded cards (PSA/BGS/CGC…), sealed products, and non-English printings are not valued.
          </li>
          <li>Source data can lag, contain gaps, or be revised by the providers.</li>
          <li>Variant coverage depends on source evidence and may be incomplete for older sets.</li>
          <li>Nothing on Pokector is financial advice.</li>
        </ul>
      </Section>

      <p className="text-sm text-fg-muted">
        Questions about the data?{" "}
        <Link to="/contact" className="text-accent hover:underline">
          Contact us
        </Link>
        .
      </p>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold text-fg">{title}</h2>
      <div className="flex flex-col gap-3 text-fg-muted">{children}</div>
    </section>
  );
}
