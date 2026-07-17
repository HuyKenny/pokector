import { useState } from "react";
import { Form, Link, useFetcher } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/binders.$binderId";
import { Alert, Button, Card, Input } from "~/components/ui";
import { requireUser } from "~/lib/auth/guards.server";
import { getCloudflare } from "~/lib/context";
import { createDb, schema } from "~/lib/db/index.server";
import {
  clearSlot,
  deleteBinder,
  getBinderSlots,
  getOwnedBinder,
  moveSlot,
  placeInSlot,
  swapPages,
  updateBinder,
  type BinderSlotView,
} from "~/lib/binders/queries.server";
import { LIMITS } from "~/lib/limits";
import { enforceRateLimit } from "~/lib/security/rate-limit.server";
import { and, desc, eq, notInArray } from "drizzle-orm";

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [
    { title: `${data?.binder.name ?? "Binder"} — Pokector` },
    { name: "robots", content: "noindex" },
  ];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);

  const binder = await getOwnedBinder(db, session.user.id, params.binderId);
  // 404 (not 403) so binder IDs cannot be enumerated (SPEC §22).
  if (!binder) throw new Response("Not Found", { status: 404 });

  const slots = await getBinderSlots(db, binder.id);
  const placedEntryIds = slots
    .map((s) => s.collectionEntryId)
    .filter((id): id is string => id !== null);

  // Entries not yet in this binder, for the placement picker.
  const candidates = await db
    .select({
      id: schema.collectionEntries.id,
      cardName: schema.pokemonCards.name,
      variant: schema.collectionEntries.variant,
      imageSmallUrl: schema.pokemonCards.imageSmallUrl,
    })
    .from(schema.collectionEntries)
    .innerJoin(schema.pokemonCards, eq(schema.collectionEntries.cardId, schema.pokemonCards.id))
    .where(
      and(
        eq(schema.collectionEntries.userId, session.user.id),
        ...(placedEntryIds.length > 0
          ? [notInArray(schema.collectionEntries.id, placedEntryIds)]
          : []),
      ),
    )
    .orderBy(desc(schema.collectionEntries.updatedAt))
    .limit(30);

  const maxPage = slots.reduce((max, slot) => Math.max(max, slot.pageNumber), 1);

  return {
    binder: {
      id: binder.id,
      name: binder.name,
      description: binder.description,
      visibility: binder.visibility,
      publicSlug: binder.publicSlug,
    },
    slots,
    candidates,
    pageCount: maxPage,
    appUrl: env.APP_URL,
  };
}

const Position = z.object({
  pageNumber: z.coerce.number().int().min(1).max(LIMITS.maxBinderPages),
  side: z.enum(["front", "back"]),
  slotNumber: z.coerce.number().int().min(1).max(9),
});

const ActionSchema = z.discriminatedUnion("intent", [
  Position.extend({ intent: z.literal("place"), entryId: z.string().uuid() }),
  z.object({ intent: z.literal("clear"), slotId: z.string().uuid() }),
  z.object({
    intent: z.literal("move"),
    fromPage: z.coerce.number().int().min(1),
    fromSide: z.enum(["front", "back"]),
    fromSlot: z.coerce.number().int().min(1).max(9),
    toPage: z.coerce.number().int().min(1).max(LIMITS.maxBinderPages),
    toSide: z.enum(["front", "back"]),
    toSlot: z.coerce.number().int().min(1).max(9),
  }),
  z.object({
    intent: z.literal("swap-pages"),
    pageA: z.coerce.number().int().min(1),
    pageB: z.coerce.number().int().min(1).max(LIMITS.maxBinderPages),
  }),
  z.object({
    intent: z.literal("settings"),
    name: z.string().trim().min(1).max(LIMITS.maxNameLength),
    description: z.string().trim().max(500),
    visibility: z.enum(["private", "unlisted", "public"]),
    regenerateSlug: z.string().optional(),
  }),
  z.object({ intent: z.literal("delete"), confirm: z.literal("DELETE") }),
]);

export async function action({ request, params, context }: Route.ActionArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  await enforceRateLimit(createDb(env.DB), "apiWrite", session.user.id);
  const db = createDb(env.DB);
  const userId = session.user.id;
  const binderId = params.binderId;

  const parsed = ActionSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) {
    return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const input = parsed.data;

  switch (input.intent) {
    case "place": {
      const result = await placeInSlot(
        db,
        userId,
        binderId,
        { pageNumber: input.pageNumber, side: input.side, slotNumber: input.slotNumber },
        input.entryId,
      );
      return { ok: result.ok, message: result.message };
    }
    case "clear": {
      const ok = await clearSlot(db, userId, binderId, input.slotId);
      return {
        ok,
        message: ok ? "Slot cleared (card stays in your collection)." : "Slot not found.",
      };
    }
    case "move": {
      const ok = await moveSlot(
        db,
        userId,
        binderId,
        { pageNumber: input.fromPage, side: input.fromSide, slotNumber: input.fromSlot },
        { pageNumber: input.toPage, side: input.toSide, slotNumber: input.toSlot },
      );
      return { ok, message: ok ? "Card moved." : "Move failed." };
    }
    case "swap-pages": {
      const ok = await swapPages(db, userId, binderId, input.pageA, input.pageB);
      return {
        ok,
        message: ok ? `Pages ${input.pageA} and ${input.pageB} swapped.` : "Swap failed.",
      };
    }
    case "settings": {
      const ok = await updateBinder(db, userId, binderId, {
        name: input.name,
        description: input.description || null,
        visibility: input.visibility,
        regenerateSlug: input.regenerateSlug === "1",
      });
      return { ok, message: ok ? "Binder settings saved." : "Binder not found." };
    }
    case "delete": {
      const ok = await deleteBinder(db, userId, binderId);
      if (ok) throw new Response(null, { status: 302, headers: { Location: "/app/binders" } });
      return { ok: false as const, message: "Binder not found." };
    }
  }
}

type SlotKey = { pageNumber: number; side: "front" | "back"; slotNumber: number };

export default function BinderDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { binder, slots, candidates, pageCount, appUrl } = loaderData;
  const fetcher = useFetcher();
  const [visiblePages, setVisiblePages] = useState(pageCount);
  const [pickedEntry, setPickedEntry] = useState<string | null>(null);
  const [moveFrom, setMoveFrom] = useState<SlotKey | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const slotMap = new Map<string, BinderSlotView>();
  for (const slot of slots) slotMap.set(`${slot.pageNumber}:${slot.side}:${slot.slotNumber}`, slot);

  function onSlotClick(position: SlotKey, slot: BinderSlotView | undefined) {
    if (pickedEntry) {
      void fetcher.submit(
        {
          intent: "place",
          entryId: pickedEntry,
          pageNumber: String(position.pageNumber),
          side: position.side,
          slotNumber: String(position.slotNumber),
        },
        { method: "post" },
      );
      setPickedEntry(null);
      return;
    }
    if (moveFrom) {
      void fetcher.submit(
        {
          intent: "move",
          fromPage: String(moveFrom.pageNumber),
          fromSide: moveFrom.side,
          fromSlot: String(moveFrom.slotNumber),
          toPage: String(position.pageNumber),
          toSide: position.side,
          toSlot: String(position.slotNumber),
        },
        { method: "post" },
      );
      setMoveFrom(null);
      return;
    }
    if (slot?.cardId) {
      setMoveFrom(position);
    }
  }

  const mode = pickedEntry ? "placing" : moveFrom ? "moving" : "idle";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
            <Link to="/app/binders" className="hover:text-fg">
              Binders
            </Link>
            <span aria-hidden="true"> / </span>
            <span aria-current="page" className="text-fg">
              {binder.name}
            </span>
          </nav>
          <h1 className="text-2xl font-bold text-fg">{binder.name}</h1>
          {binder.description ? (
            <p className="text-sm text-fg-muted">{binder.description}</p>
          ) : null}
        </div>
        <Button
          variant="secondary"
          onClick={() => setShowSettings((v) => !v)}
          aria-expanded={showSettings}
        >
          Settings &amp; sharing
        </Button>
      </div>

      {actionData ? (
        <Alert tone={actionData.ok ? "success" : "error"}>{actionData.message}</Alert>
      ) : null}
      {fetcher.data && typeof fetcher.data === "object" && "message" in fetcher.data ? (
        <p role="status" className="text-sm text-fg-muted">
          {String((fetcher.data as { message: string }).message)}
        </p>
      ) : null}

      {showSettings ? <SettingsPanel binder={binder} appUrl={appUrl} /> : null}

      {/* Mode banner */}
      {mode !== "idle" ? (
        <div
          role="status"
          className="flex items-center justify-between rounded-lg border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-fg"
        >
          {mode === "placing"
            ? "Click any slot to place the selected card."
            : "Click a target slot to move the card (occupied slots swap)."}
          <button
            type="button"
            className="font-medium text-accent hover:underline"
            onClick={() => {
              setPickedEntry(null);
              setMoveFrom(null);
            }}
          >
            Cancel
          </button>
        </div>
      ) : null}

      {/* Add from collection */}
      <Card>
        <h2 className="mb-3 text-lg font-semibold text-fg">Place a card from your collection</h2>
        {candidates.length === 0 ? (
          <p className="text-sm text-fg-muted">
            Every entry is already placed, or your{" "}
            <Link to="/app/collection" className="text-accent hover:underline">
              collection
            </Link>{" "}
            is empty.
          </p>
        ) : (
          <ul className="flex gap-3 overflow-x-auto pb-2">
            {candidates.map((entry) => (
              <li key={entry.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setPickedEntry(pickedEntry === entry.id ? null : entry.id);
                    setMoveFrom(null);
                  }}
                  aria-pressed={pickedEntry === entry.id}
                  className={`flex w-20 flex-col items-center gap-1 rounded-lg border p-1.5 text-center ${
                    pickedEntry === entry.id
                      ? "border-accent bg-accent-soft"
                      : "border-edge hover:border-accent"
                  }`}
                >
                  {entry.imageSmallUrl ? (
                    <img
                      src={entry.imageSmallUrl}
                      alt=""
                      loading="lazy"
                      className="aspect-[63/88] w-full rounded object-cover"
                    />
                  ) : (
                    <span className="flex aspect-[63/88] w-full items-center justify-center rounded bg-surface-raised text-xs">
                      ?
                    </span>
                  )}
                  <span className="w-full truncate text-[10px] text-fg">{entry.cardName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Pages */}
      {Array.from({ length: visiblePages }, (_, i) => i + 1).map((pageNumber) => (
        <section key={pageNumber} aria-label={`Page ${pageNumber}`} className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-fg">Page {pageNumber}</h2>
            {pageNumber > 1 ? (
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="swap-pages" />
                <input type="hidden" name="pageA" value={pageNumber} />
                <input type="hidden" name="pageB" value={pageNumber - 1} />
                <button type="submit" className="text-xs font-medium text-accent hover:underline">
                  ↑ Move page up
                </button>
              </fetcher.Form>
            ) : null}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {(["front", "back"] as const).map((side) => (
              <div key={side}>
                <p className="mb-1 text-xs uppercase tracking-wide text-fg-faint">{side}</p>
                <div className="grid grid-cols-3 gap-2 rounded-(--radius-card) border border-edge bg-surface p-3">
                  {Array.from({ length: 9 }, (_, i) => i + 1).map((slotNumber) => {
                    const key = `${pageNumber}:${side}:${slotNumber}`;
                    const slot = slotMap.get(key);
                    const isMoveSource =
                      moveFrom?.pageNumber === pageNumber &&
                      moveFrom.side === side &&
                      moveFrom.slotNumber === slotNumber;
                    return (
                      <div key={key} className="relative">
                        <button
                          type="button"
                          onClick={() => onSlotClick({ pageNumber, side, slotNumber }, slot)}
                          aria-label={
                            slot?.cardName
                              ? `${side} page ${pageNumber}, slot ${slotNumber}: ${slot.cardName}. ${mode === "idle" ? "Select to move." : "Place here."}`
                              : `${side} page ${pageNumber}, slot ${slotNumber}: empty${mode !== "idle" ? ". Place here." : ""}`
                          }
                          className={`aspect-[63/88] w-full overflow-hidden rounded-md border ${
                            isMoveSource
                              ? "border-secondary ring-2 ring-secondary"
                              : slot?.cardId
                                ? "border-edge hover:border-accent"
                                : "border-dashed border-edge bg-surface-raised hover:border-accent"
                          }`}
                        >
                          {slot?.imageSmallUrl ? (
                            <img
                              src={slot.imageSmallUrl}
                              alt=""
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          ) : slot?.cardName ? (
                            <span className="p-1 text-[10px] text-fg">{slot.cardName}</span>
                          ) : (
                            <span aria-hidden="true" className="text-fg-faint">
                              +
                            </span>
                          )}
                        </button>
                        {slot?.cardId && mode === "idle" ? (
                          <fetcher.Form method="post" className="absolute right-1 top-1">
                            <input type="hidden" name="intent" value="clear" />
                            <input type="hidden" name="slotId" value={slot.id} />
                            <button
                              type="submit"
                              aria-label={`Remove ${slot.cardName ?? "card"} from this slot`}
                              className="rounded bg-surface/90 px-1 text-xs text-fg-muted hover:text-negative"
                            >
                              ✕
                            </button>
                          </fetcher.Form>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {visiblePages < LIMITS.maxBinderPages ? (
        <Button
          variant="secondary"
          onClick={() => setVisiblePages((v) => v + 1)}
          className="self-start"
        >
          + Add page
        </Button>
      ) : null}
    </div>
  );
}

function SettingsPanel({
  binder,
  appUrl,
}: {
  binder: {
    id: string;
    name: string;
    description: string | null;
    visibility: string;
    publicSlug: string | null;
  };
  appUrl: string;
}) {
  const shareUrl = binder.publicSlug ? `${appUrl}/binders/${binder.publicSlug}` : null;
  return (
    <Card>
      <h2 className="mb-3 text-lg font-semibold text-fg">Binder settings</h2>
      <Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="intent" value="settings" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Name"
            id="s-name"
            name="name"
            defaultValue={binder.name}
            required
            maxLength={LIMITS.maxNameLength}
          />
          <Input
            label="Description"
            id="s-desc"
            name="description"
            defaultValue={binder.description ?? ""}
            maxLength={500}
          />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-fg">Sharing</legend>
          {(
            [
              ["private", "Private — only you can see this binder"],
              ["unlisted", "Unlisted — anyone with the link can view it"],
              ["public", "Public — viewable via share link"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm text-fg">
              <input
                type="radio"
                name="visibility"
                value={value}
                defaultChecked={binder.visibility === value}
              />
              {label}
            </label>
          ))}
          <p className="text-xs text-fg-faint">
            Shared binders never show purchase prices, notes, or your e-mail address.
          </p>
        </fieldset>
        {shareUrl ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm text-fg">
              Share link:{" "}
              <a href={shareUrl} className="break-all text-accent hover:underline">
                {shareUrl}
              </a>
            </p>
            <label className="flex items-center gap-2 text-sm text-fg-muted">
              <input type="checkbox" name="regenerateSlug" value="1" />
              Regenerate the link (old link stops working)
            </label>
          </div>
        ) : null}
        <Button type="submit" className="self-start">
          Save settings
        </Button>
      </Form>
      <Form
        method="post"
        className="mt-6 border-t border-edge pt-4"
        onSubmit={(e) => {
          if (!confirm("Delete this binder? Cards stay in your collection.")) e.preventDefault();
        }}
      >
        <input type="hidden" name="intent" value="delete" />
        <input type="hidden" name="confirm" value="DELETE" />
        <Button type="submit" variant="danger">
          Delete binder
        </Button>
      </Form>
    </Card>
  );
}
