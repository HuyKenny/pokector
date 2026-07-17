import { Link } from "react-router";

import type { Route } from "./+types/about";
import { getCloudflare } from "~/lib/context";
import { canonicalUrl, pageMeta } from "~/lib/seo/meta";

export function meta({ loaderData: data }: Route.MetaArgs) {
  return pageMeta({
    title: "About Pokector — An Independent Pokémon TCG Collection Tracker",
    description:
      "Why Pokector exists: an independent, honest collection tracker for Pokémon TCG collectors — transparent prices, real history, no hype.",
    canonical: data?.canonical,
  });
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" };
}

export function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  return { canonical: canonicalUrl(env.APP_URL, "/about") };
}

export default function About() {
  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-3xl font-bold text-fg">About Pokector</h1>
      <p className="text-lg text-fg-muted">
        Pokector started with a binder, a spreadsheet, and the nagging question every collector
        knows: <em>“what is all this actually worth by now?”</em>
      </p>
      <div className="flex flex-col gap-4 text-fg-muted">
        <p>
          Spreadsheets get stale the day you make them. Marketplace tabs answer one card at a time.
          And many tracking apps blur the line between collecting and speculating — pushing hype,
          gamified numbers, and price charts that promise more than the data can honestly say.
        </p>
        <p>
          Pokector is our answer: a focused web app that does one thing well — tracking a raw
          Pokémon TCG card collection against real market estimates. You record what you own, and
          Pokector keeps score: current estimated value, what you paid, set completion, binders,
          wishlists, and price alerts.
        </p>
        <p>
          The core promise is honesty. Prices show their source and date. Unpriced cards say
          “unpriced”, not “$0”. History charts begin the day tracking begins — we never draw lines
          through data that doesn't exist. The full rules are public on the{" "}
          <Link to="/methodology" className="text-accent hover:underline">
            methodology page
          </Link>
          .
        </p>
        <p>
          Pokector is an <strong>independent project</strong>. It is not affiliated with, endorsed
          by, sponsored by, or officially connected to Nintendo, The Pokémon Company, Game Freak,
          Creatures, TCGplayer, Cardmarket, or the Pokémon TCG API. Pokémon and Pokémon character
          names are trademarks of Nintendo. We're simply collectors building the tool we wanted to
          use.
        </p>
      </div>
      <div className="flex gap-3">
        <Link
          to="/register"
          className="rounded-xl bg-accent px-6 py-3 font-medium text-(color:--color-on-accent) hover:bg-accent-strong"
        >
          Start your collection
        </Link>
        <Link
          to="/contact"
          className="rounded-xl border border-edge bg-surface px-6 py-3 font-medium text-fg hover:bg-surface-raised"
        >
          Get in touch
        </Link>
      </div>
    </article>
  );
}
