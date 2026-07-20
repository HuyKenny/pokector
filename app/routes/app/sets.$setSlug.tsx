import { Form, Link, useFetcher, useSearchParams } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/sets.$setSlug";
import { Alert, Button, Card } from "~/components/ui";
import { requireUser } from "~/lib/auth/guards.server";
import { getCloudflare } from "~/lib/context";
import { createDb, schema } from "~/lib/db/index.server";
import { getSetBySlug } from "~/lib/catalog/queries.server";
import { computeSetProgress } from "~/lib/sets/progress.server";
import { formatMinor } from "~/lib/money/decimal";
import { and, count, eq, ne } from "drizzle-orm";
import { getUserPlan } from "~/lib/billing/entitlement.server";
import { limitsFor } from "~/lib/limits";

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [
    { title: `${data?.set.name ?? "Set"} checklist — Pokector` },
    { name: "robots", content: "noindex" },
  ];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const data = await getSetBySlug(db, params.setSlug);
  if (!data) throw new Response("Set not found", { status: 404 });

  const url = new URL(request.url);
  const progress = await computeSetProgress(db, session.user.id, data.set.id);

  const goal = await db.query.setGoals.findFirst({
    where: and(
      eq(schema.setGoals.userId, session.user.id),
      eq(schema.setGoals.setId, data.set.id),
      eq(schema.setGoals.checklistMode, "standard"),
    ),
  });

  // Estimated variant checklist mode: derive variant slots from price evidence.
  const mode =
    url.searchParams.get("mode") === "variant" ? ("variant" as const) : ("standard" as const);
  let variantRows: { cardId: string; variant: string }[] = [];
  let ownedVariants = new Set<string>();
  if (mode === "variant") {
    const variantData = await db
      .selectDistinct({
        cardId: schema.cardPricesCurrent.cardId,
        variant: schema.cardPricesCurrent.variant,
      })
      .from(schema.cardPricesCurrent)
      .innerJoin(schema.pokemonCards, eq(schema.cardPricesCurrent.cardId, schema.pokemonCards.id))
      .where(eq(schema.pokemonCards.setId, data.set.id));
    variantRows = variantData;
    const ownedVariantRows = await db
      .selectDistinct({
        cardId: schema.collectionEntries.cardId,
        variant: schema.collectionEntries.variant,
      })
      .from(schema.collectionEntries)
      .innerJoin(schema.pokemonCards, eq(schema.collectionEntries.cardId, schema.pokemonCards.id))
      .where(
        and(
          eq(schema.collectionEntries.userId, session.user.id),
          eq(schema.pokemonCards.setId, data.set.id),
        ),
      );
    ownedVariants = new Set(ownedVariantRows.map((r) => `${r.cardId}:${r.variant}`));
  }

  return {
    set: {
      id: data.set.id,
      slug: data.set.slug,
      name: data.set.name,
      series: data.set.series,
      symbolUrl: data.set.symbolUrl,
    },
    cards: data.cards,
    progress: {
      ownedCount: progress.ownedCount,
      totalCount: progress.totalCount,
      missingCount: progress.missingCount,
      completionPercent: progress.completionPercent,
      missingValueMinor: progress.missingValueMinor,
      ownedCardIds: progress.ownedCardIds,
    },
    goal: goal ? { pinned: goal.pinned, targetDate: goal.targetDate } : null,
    mode,
    variantRows,
    ownedVariantKeys: [...ownedVariants],
  };
}

const GoalSchema = z.object({
  intent: z.literal("goal"),
  pinned: z.string().optional(),
  targetDate: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Invalid date."),
});

export async function action({ request, params, context }: Route.ActionArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const data = await getSetBySlug(db, params.setSlug);
  if (!data) throw new Response("Set not found", { status: 404 });

  const parsed = GoalSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return { ok: false as const, message: "Invalid input." };

  // Meter pinned sets by plan (free pins a favourite; Pro pins as many as it likes).
  // Count OTHER pinned sets so re-saving an already-pinned set is always allowed.
  if (parsed.data.pinned === "1") {
    const plan = await getUserPlan(db, session.user.id);
    const [{ n }] = await db
      .select({ n: count() })
      .from(schema.setGoals)
      .where(
        and(
          eq(schema.setGoals.userId, session.user.id),
          eq(schema.setGoals.pinned, true),
          ne(schema.setGoals.setId, data.set.id),
        ),
      );
    if (n >= limitsFor(plan).maxPinnedSets) {
      return {
        ok: false as const,
        message: "You've reached the free-plan pin limit — upgrade to Pro to pin more sets.",
      };
    }
  }

  await db
    .insert(schema.setGoals)
    .values({
      id: crypto.randomUUID(),
      userId: session.user.id,
      setId: data.set.id,
      checklistMode: "standard",
      pinned: parsed.data.pinned === "1",
      targetDate: parsed.data.targetDate,
    })
    .onConflictDoUpdate({
      target: [schema.setGoals.userId, schema.setGoals.setId, schema.setGoals.checklistMode],
      set: { pinned: parsed.data.pinned === "1", targetDate: parsed.data.targetDate },
    });
  return { ok: true as const, message: "Goal saved." };
}

export default function SetChecklist({ loaderData, actionData }: Route.ComponentProps) {
  const { set, cards, progress, goal, mode, variantRows, ownedVariantKeys } = loaderData;
  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher();
  const show = searchParams.get("show");
  const sortByPrice = searchParams.get("sortMissing") === "price";

  const ownedSet = new Set(progress.ownedCardIds);
  const ownedVariantSet = new Set(ownedVariantKeys);
  const variantsByCard = new Map<string, string[]>();
  for (const row of variantRows) {
    variantsByCard.set(row.cardId, [...(variantsByCard.get(row.cardId) ?? []), row.variant]);
  }

  let visible = cards.filter((card) => {
    if (show === "owned") return ownedSet.has(card.id);
    if (show === "missing") return !ownedSet.has(card.id);
    return true;
  });
  if (sortByPrice && show === "missing") {
    visible = [...visible].sort((a, b) => (b.priceMinor ?? -1) - (a.priceMinor ?? -1));
  }

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { preventScrollReset: true });
  }

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
        <Link to="/app/sets" className="hover:text-fg">
          My sets
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page" className="text-fg">
          {set.name}
        </span>
      </nav>

      <div className="flex flex-wrap items-center gap-3">
        {set.symbolUrl ? <img src={set.symbolUrl} alt="" className="h-8 w-8" /> : null}
        <h1 className="text-2xl font-bold text-fg">{set.name} checklist</h1>
        <Link to={`/sets/${set.slug}`} className="text-sm text-accent hover:underline">
          Public set page →
        </Link>
      </div>

      {actionData && "message" in actionData ? (
        <Alert tone={actionData.ok ? "success" : "error"}>{actionData.message}</Alert>
      ) : null}

      {/* Progress + goal */}
      <Card>
        <div
          role="progressbar"
          aria-valuenow={Math.round(progress.completionPercent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Set completion"
          className="mb-2 h-3 w-full overflow-hidden rounded-full bg-surface-raised"
        >
          <div className="h-full bg-accent" style={{ width: `${progress.completionPercent}%` }} />
        </div>
        <p className="text-sm text-fg-muted">
          <strong className="text-fg">{progress.ownedCount}</strong>/{progress.totalCount} owned ·{" "}
          {progress.missingCount} missing · {progress.completionPercent.toFixed(1)}%
          {progress.missingValueMinor !== null
            ? ` · missing cards ≈ ${formatMinor(progress.missingValueMinor)}`
            : ""}
        </p>
        <Form method="post" className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="intent" value="goal" />
          <label className="flex min-h-11 items-center gap-2 text-sm text-fg">
            <input type="checkbox" name="pinned" value="1" defaultChecked={goal?.pinned ?? false} />
            Pin this set
          </label>
          <div className="flex flex-col gap-1">
            <label htmlFor="target-date" className="text-xs font-medium text-fg">
              Completion goal date
            </label>
            <input
              id="target-date"
              type="date"
              name="targetDate"
              defaultValue={goal?.targetDate ?? ""}
              className="min-h-11 rounded-lg border border-edge bg-surface px-3 text-sm text-fg"
            />
          </div>
          <Button type="submit" variant="secondary">
            Save goal
          </Button>
          <a
            href={`/app/sets/${set.slug}/export-missing`}
            className="min-h-11 rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg hover:bg-surface-raised"
          >
            Export missing (CSV)
          </a>
        </Form>
      </Card>

      {/* Mode + filters */}
      <div
        className="flex flex-wrap items-center gap-2 text-sm"
        role="group"
        aria-label="Checklist filters"
      >
        <Chip
          active={mode === "standard"}
          onClick={() => setParam("mode", null)}
          label="Standard checklist"
        />
        <Chip
          active={mode === "variant"}
          onClick={() => setParam("mode", "variant")}
          label="Variant checklist (estimated)"
        />
        <span aria-hidden="true" className="mx-1 text-fg-faint">
          |
        </span>
        <Chip active={show === null} onClick={() => setParam("show", null)} label="All" />
        <Chip active={show === "owned"} onClick={() => setParam("show", "owned")} label="Owned" />
        <Chip
          active={show === "missing"}
          onClick={() => setParam("show", "missing")}
          label="Missing"
        />
        {show === "missing" ? (
          <Chip
            active={sortByPrice}
            onClick={() => setParam("sortMissing", sortByPrice ? null : "price")}
            label="Sort by price"
          />
        ) : null}
      </div>
      {mode === "variant" ? (
        <p className="rounded-lg border border-warning/40 bg-surface-raised px-4 py-3 text-xs text-fg-muted">
          Variant checklist is <strong>estimated</strong>: variant slots are derived from market
          price evidence, and source coverage may be incomplete — especially for older sets.
        </p>
      ) : null}

      {/* Checklist */}
      <ul className="flex flex-col divide-y divide-edge/50 rounded-(--radius-card) border border-edge bg-surface">
        {visible.map((card) => {
          const owned = ownedSet.has(card.id);
          const cardVariants = mode === "variant" ? (variantsByCard.get(card.id) ?? []) : [];
          return (
            <li key={card.id} className="flex items-center gap-3 p-3">
              <span
                aria-hidden="true"
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  owned
                    ? "bg-accent text-(color:--color-on-accent)"
                    : "border border-edge text-fg-faint"
                }`}
              >
                {owned ? "✓" : ""}
              </span>
              <span className="sr-only">{owned ? "Owned:" : "Missing:"}</span>
              <Link to={`/cards/${card.slug}`} className="min-w-0 flex-1 hover:text-accent">
                <span className="font-medium text-fg">{card.name}</span>{" "}
                <span className="text-xs text-fg-faint">
                  #{card.number}
                  {card.rarity ? ` · ${card.rarity}` : ""}
                  {card.priceMinor !== null ? ` · ${formatMinor(card.priceMinor)}` : ""}
                </span>
                {mode === "variant" && cardVariants.length > 0 ? (
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {cardVariants.map((variant) => {
                      const has = ownedVariantSet.has(`${card.id}:${variant}`);
                      return (
                        <span
                          key={variant}
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            has
                              ? "bg-accent-soft text-accent-strong"
                              : "border border-edge text-fg-faint"
                          }`}
                        >
                          {has ? "✓ " : ""}
                          {variant}
                        </span>
                      );
                    })}
                  </span>
                ) : null}
              </Link>
              {owned ? (
                <fetcher.Form method="post" action="/api/v1/collection/quick-add">
                  <input type="hidden" name="cardId" value={card.id} />
                  <Button type="submit" variant="ghost" aria-label={`Add another ${card.name}`}>
                    +1
                  </Button>
                </fetcher.Form>
              ) : (
                <div className="flex shrink-0 gap-1">
                  <fetcher.Form method="post" action="/api/v1/collection/quick-add">
                    <input type="hidden" name="cardId" value={card.id} />
                    <Button
                      type="submit"
                      variant="secondary"
                      aria-label={`Add ${card.name} to collection`}
                    >
                      Got it
                    </Button>
                  </fetcher.Form>
                  <fetcher.Form method="post" action="/api/v1/wishlist/quick-add">
                    <input type="hidden" name="cardId" value={card.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      aria-label={`Add ${card.name} to wishlist`}
                    >
                      Wishlist
                    </Button>
                  </fetcher.Form>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-9 rounded-full px-3 text-xs font-medium ${
        active
          ? "bg-accent text-(color:--color-on-accent)"
          : "border border-edge text-fg-muted hover:text-fg"
      }`}
    >
      {label}
    </button>
  );
}
