import { Link } from "react-router";

import type { Route } from "./+types/disclaimer";
import { getCloudflare } from "~/lib/context";
import { canonicalUrl, pageMeta } from "~/lib/seo/meta";

export function meta({ loaderData: data }: Route.MetaArgs) {
  return pageMeta({
    title: "Disclaimer | Pokector",
    description:
      "Important limitations of Pokector's price estimates and the project's independence from Nintendo, The Pokémon Company, TCGplayer, and Cardmarket.",
    canonical: data?.canonical,
  });
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" };
}

export function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  return { canonical: canonicalUrl(env.APP_URL, "/disclaimer") };
}

export default function Disclaimer() {
  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-5 text-sm leading-relaxed text-fg-muted">
      <h1 className="text-3xl font-bold text-fg">Disclaimer</h1>

      <h2 className="mt-2 text-lg font-semibold text-fg">Independence</h2>
      <p>
        Pokector is an independent project. It is <strong>not</strong> affiliated with, endorsed by,
        sponsored by, or officially connected to Nintendo, The Pokémon Company, Game Freak,
        Creatures, TCGplayer, Cardmarket, or the Pokémon TCG API. Pokémon and Pokémon character
        names are trademarks of Nintendo. Card images, names, and catalog data are the property of
        their respective owners and are shown for identification of collectible items.
      </p>

      <h2 className="mt-2 text-lg font-semibold text-fg">Price estimates</h2>
      <p>
        All prices, set values, portfolio values, and price changes shown on Pokector are estimates
        derived from third-party market data for <strong>raw (ungraded)</strong> cards. They may be
        inaccurate, incomplete, or out of date, and they do not account for your card's physical
        condition, printing peculiarities, local market, fees, or shipping. Actual sale prices can
        differ substantially.
      </p>

      <h2 className="mt-2 text-lg font-semibold text-fg">No financial advice</h2>
      <p>
        Nothing on this site is financial, investment, tax, or trading advice, or a recommendation
        to buy, sell, or hold any collectible. Collectible prices can fall as well as rise. Make
        your own decisions and consult a professional where appropriate.
      </p>

      <h2 className="mt-2 text-lg font-semibold text-fg">How the numbers are made</h2>
      <p>
        The exact rules for sourcing and computing every number are public on the{" "}
        <Link to="/methodology" className="text-accent hover:underline">
          methodology page
        </Link>
        .
      </p>
    </article>
  );
}
