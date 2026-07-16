import type { Route } from "./+types/home";
import { PokectorWordmark } from "../components/brand";

// Interim homepage — replaced by the full public homepage in Phase 5.
export function meta(_args: Route.MetaArgs) {
  return [
    { title: "Pokector — Pokémon TCG Collection Tracker" },
    {
      name: "description",
      content:
        "Track your Pokémon TCG collection, monitor estimated market value, organize binders, and complete sets.",
    },
  ];
}

export default function Home() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center gap-6 px-4 py-16 text-center">
      <PokectorWordmark className="h-12" />
      <h1 className="text-4xl font-bold tracking-tight text-fg">
        Your Pokémon TCG collection, valued.
      </h1>
      <p className="max-w-lg text-lg text-fg-muted">
        Pokector is being assembled. Soon you will be able to browse the card catalog, track your
        collection, and watch your portfolio value over time.
      </p>
      <p className="text-xs text-fg-faint">
        Pokector is an independent project and is not affiliated with, endorsed by, or sponsored by
        Nintendo, The Pokémon Company, Game Freak, Creatures, TCGplayer, or Cardmarket.
      </p>
    </main>
  );
}
