import { Link } from "react-router";

import type { Route } from "./+types/binders.$publicSlug";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { getPublicBinder } from "~/lib/binders/queries.server";
import { clientIp, enforceRateLimit } from "~/lib/security/rate-limit.server";

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [
    { title: data ? `${data.binder.name} — shared binder | Pokector` : "Binder | Pokector" },
    // Unlisted binders must not be indexed; public ones are also kept out of
    // the index — share links are for people, not crawlers.
    { name: "robots", content: "noindex" },
  ];
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "private, no-store" };
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  // Rate limit share-link guessing (128-bit slugs + throttle — SPEC §22).
  await enforceRateLimit(env.KV, "publicBinderView", clientIp(request));
  const db = createDb(env.DB);
  const binder = await getPublicBinder(db, params.publicSlug);
  if (!binder) throw new Response("Not Found", { status: 404 });
  return { binder };
}

export default function PublicBinder({ loaderData }: Route.ComponentProps) {
  const { binder } = loaderData;
  const pages = [...new Set(binder.slots.map((s) => s.pageNumber))].sort((a, b) => a - b);
  const slotMap = new Map(
    binder.slots.map((s) => [`${s.pageNumber}:${s.side}:${s.slotNumber}`, s]),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold text-fg">{binder.name}</h1>
        <p className="text-sm text-fg-muted">
          A shared binder by {binder.ownerDisplayName}
          {binder.description ? ` — ${binder.description}` : ""}
        </p>
      </div>

      {pages.length === 0 ? (
        <p className="rounded-(--radius-card) border border-edge bg-surface p-8 text-center text-fg-muted">
          This binder is empty.
        </p>
      ) : (
        pages.map((pageNumber) => (
          <section
            key={pageNumber}
            aria-label={`Page ${pageNumber}`}
            className="flex flex-col gap-3"
          >
            <h2 className="font-semibold text-fg">Page {pageNumber}</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {(["front", "back"] as const).map((side) => {
                const hasAny = binder.slots.some(
                  (s) => s.pageNumber === pageNumber && s.side === side,
                );
                if (!hasAny) return null;
                return (
                  <div key={side}>
                    <p className="mb-1 text-xs uppercase tracking-wide text-fg-faint">{side}</p>
                    <div className="grid grid-cols-3 gap-2 rounded-(--radius-card) border border-edge bg-surface p-3">
                      {Array.from({ length: 9 }, (_, i) => i + 1).map((slotNumber) => {
                        const slot = slotMap.get(`${pageNumber}:${side}:${slotNumber}`);
                        return (
                          <div
                            key={slotNumber}
                            className="aspect-[63/88] overflow-hidden rounded-md border border-edge bg-surface-raised"
                          >
                            {slot?.imageSmallUrl && slot.cardSlug ? (
                              <Link to={`/cards/${slot.cardSlug}`}>
                                <img
                                  src={slot.imageSmallUrl}
                                  alt={slot.cardName ?? "Card"}
                                  loading="lazy"
                                  className="h-full w-full object-cover"
                                />
                              </Link>
                            ) : slot?.cardName ? (
                              <span className="p-1 text-[10px] text-fg">{slot.cardName}</span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}

      <p className="text-xs text-fg-faint">
        Shared binders show cards only — never prices paid or personal notes. Want your own?{" "}
        <Link to="/register" className="text-accent hover:underline">
          Create a free Pokector account
        </Link>
        .
      </p>
    </div>
  );
}
