import { useEffect, useRef, useState } from "react";
import { Form, Link, useFetcher, useSearchParams } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/collection";
import { Alert, Button, Card, Input } from "~/components/ui";
import { requireUser } from "~/lib/auth/guards.server";
import { getCloudflare } from "~/lib/context";
import { createDb, schema } from "~/lib/db/index.server";
import {
  addEntry,
  bulkUpdateEntries,
  deleteEntries,
  listCollection,
  updateEntry,
} from "~/lib/collection/queries.server";
import { CARD_VARIANTS, CONDITIONS, GRADES } from "~/lib/enums";
import { LIMITS } from "~/lib/limits";
import { formatMinor, toMinorUnits } from "~/lib/money/decimal";
import { enforceRateLimit } from "~/lib/security/rate-limit.server";
import { eq } from "drizzle-orm";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "My Collection — Pokector" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const url = new URL(request.url);

  const result = await listCollection(db, session.user.id, {
    q: url.searchParams.get("q") ?? undefined,
    setId: url.searchParams.get("set") ?? undefined,
    variant: url.searchParams.get("variant") ?? undefined,
    condition: url.searchParams.get("condition") ?? undefined,
    unpricedOnly: url.searchParams.get("unpriced") === "1",
    sort:
      (url.searchParams.get("sort") as "updated" | "name" | "value" | "quantity" | null) ??
      undefined,
    page: Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
  });

  return {
    ...result,
    items: result.items.map((item) => ({ ...item, updatedAt: item.updatedAt.getTime() })),
    view: url.searchParams.get("view") === "grid" ? ("grid" as const) : ("table" as const),
  };
}

const VARIANTS = CARD_VARIANTS;
const GRADE_LABELS: Record<(typeof GRADES)[number], string> = {
  raw: "Raw",
  psa9: "PSA 9",
  psa10: "PSA 10",
};

const MoneySchema = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : toMinorUnits(value)))
  .refine((v) => v === null || (v >= 0 && v <= 100_000_000), "Invalid price.");

const DateSchema = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Invalid date.");

const EntryFieldsSchema = z.object({
  quantity: z.coerce.number().int().min(1).max(10_000),
  variant: z.enum(VARIANTS),
  grade: z.enum(GRADES).default("raw"),
  condition: z.enum(CONDITIONS),
  language: z.string().trim().min(1).max(40).default("English"),
  purchasePrice: MoneySchema,
  purchaseDate: DateSchema,
  notes: z
    .string()
    .trim()
    .max(LIMITS.maxNotesLength)
    .transform((v) => (v === "" ? null : v)),
});

const ActionSchema = z.discriminatedUnion("intent", [
  EntryFieldsSchema.extend({ intent: z.literal("add"), cardId: z.string().min(1).max(64) }),
  EntryFieldsSchema.extend({ intent: z.literal("update"), entryId: z.string().uuid() }),
  z.object({ intent: z.literal("delete"), entryIds: z.string().min(1) }),
  z.object({
    intent: z.literal("bulk-edit"),
    entryIds: z.string().min(1),
    condition: z.enum(CONDITIONS).optional(),
    language: z.string().trim().max(40).optional(),
  }),
]);

export async function action({ request, context }: Route.ActionArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  await enforceRateLimit(createDb(env.DB), "apiWrite", session.user.id);
  const db = createDb(env.DB);

  const parsed = ActionSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) {
    return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const input = parsed.data;

  switch (input.intent) {
    case "add": {
      const card = await db.query.pokemonCards.findFirst({
        where: eq(schema.pokemonCards.id, input.cardId),
        columns: { id: true, name: true },
      });
      if (!card) return { ok: false as const, message: "Card not found." };
      await addEntry(db, session.user.id, {
        cardId: card.id,
        quantity: input.quantity,
        variant: input.variant,
        grade: input.grade,
        condition: input.condition,
        language: input.language,
        purchasePriceMinor: input.purchasePrice,
        purchaseDate: input.purchaseDate,
        notes: input.notes,
      });
      return { ok: true as const, message: `${card.name} added to your collection.` };
    }
    case "update": {
      const updated = await updateEntry(db, session.user.id, input.entryId, {
        quantity: input.quantity,
        variant: input.variant,
        grade: input.grade,
        condition: input.condition,
        language: input.language,
        purchasePriceMinor: input.purchasePrice,
        purchaseDate: input.purchaseDate,
        notes: input.notes,
      });
      return updated
        ? { ok: true as const, message: "Entry updated." }
        : { ok: false as const, message: "Entry not found." };
    }
    case "delete": {
      const ids = input.entryIds.split(",").filter(Boolean).slice(0, 200);
      const n = await deleteEntries(db, session.user.id, ids);
      return { ok: true as const, message: `${n} ${n === 1 ? "entry" : "entries"} deleted.` };
    }
    case "bulk-edit": {
      const ids = input.entryIds.split(",").filter(Boolean).slice(0, 200);
      const n = await bulkUpdateEntries(db, session.user.id, ids, {
        condition: input.condition,
        language: input.language || undefined,
      });
      return { ok: true as const, message: `${n} ${n === 1 ? "entry" : "entries"} updated.` };
    }
  }
}

type Item = Awaited<ReturnType<typeof loader>>["items"][number];

export default function Collection({ loaderData, actionData }: Route.ComponentProps) {
  const { items, total, page, pageCount, view } = loaderData;
  const [searchParams] = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function linkWith(overrides: Record<string, string | null>): string {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(overrides)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const qs = next.toString();
    return qs ? `/app/collection?${qs}` : "/app/collection";
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-fg">
          My collection{" "}
          <span className="text-base font-normal text-fg-muted">({total} entries)</span>
        </h1>
        <div className="flex gap-2">
          <Link
            to="/app/export"
            className="min-h-11 rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg hover:bg-surface-raised"
          >
            Export CSV
          </Link>
          <Link
            to="/app/import"
            className="min-h-11 rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg hover:bg-surface-raised"
          >
            Import CSV
          </Link>
        </div>
      </div>

      {actionData ? (
        <Alert tone={actionData.ok ? "success" : "error"}>{actionData.message}</Alert>
      ) : null}

      <AddCardPanel />

      {/* Filters */}
      <Form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-44 flex-1 flex-col gap-1">
          <label htmlFor="cq" className="text-sm font-medium text-fg">
            Search my cards
          </label>
          <input
            id="cq"
            name="q"
            type="search"
            defaultValue={searchParams.get("q") ?? ""}
            className="min-h-11 rounded-lg border border-edge bg-surface px-3 text-fg"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cv" className="text-sm font-medium text-fg">
            Variant
          </label>
          <select
            id="cv"
            name="variant"
            defaultValue={searchParams.get("variant") ?? ""}
            className="min-h-11 rounded-lg border border-edge bg-surface px-3 text-fg"
          >
            <option value="">Any</option>
            {VARIANTS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cc" className="text-sm font-medium text-fg">
            Condition
          </label>
          <select
            id="cc"
            name="condition"
            defaultValue={searchParams.get("condition") ?? ""}
            className="min-h-11 rounded-lg border border-edge bg-surface px-3 text-fg"
          >
            <option value="">Any</option>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cs" className="text-sm font-medium text-fg">
            Sort
          </label>
          <select
            id="cs"
            name="sort"
            defaultValue={searchParams.get("sort") ?? "updated"}
            className="min-h-11 rounded-lg border border-edge bg-surface px-3 text-fg"
          >
            <option value="updated">Recently updated</option>
            <option value="name">Name</option>
            <option value="value">Value</option>
            <option value="quantity">Quantity</option>
          </select>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            name="unpriced"
            value="1"
            defaultChecked={searchParams.get("unpriced") === "1"}
          />
          Unpriced only
        </label>
        <Button type="submit">Apply</Button>
        <Link
          to={linkWith({ view: view === "table" ? "grid" : null })}
          className="min-h-11 rounded-lg border border-edge px-4 py-2 text-sm font-medium text-fg-muted hover:text-fg"
        >
          {view === "table" ? "Grid view" : "Table view"}
        </Link>
      </Form>

      {/* Bulk action bar */}
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-accent/40 bg-accent-soft px-4 py-3">
          <span className="text-sm font-medium text-fg">{selected.size} selected</span>
          <Form method="post" className="flex items-center gap-2">
            <input type="hidden" name="intent" value="bulk-edit" />
            <input type="hidden" name="entryIds" value={[...selected].join(",")} />
            <label htmlFor="bulk-condition" className="sr-only">
              Set condition
            </label>
            <select
              id="bulk-condition"
              name="condition"
              className="min-h-9 rounded-lg border border-edge bg-surface px-2 text-sm"
            >
              <option value="">Condition…</option>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <Button type="submit" variant="secondary">
              Apply to selected
            </Button>
          </Form>
          <Form
            method="post"
            onSubmit={(e) => {
              if (!confirm(`Delete ${selected.size} entries from your collection?`))
                e.preventDefault();
            }}
          >
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="entryIds" value={[...selected].join(",")} />
            <Button type="submit" variant="danger">
              Delete selected
            </Button>
          </Form>
          <button
            type="button"
            className="text-sm text-fg-muted hover:text-fg"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        </div>
      ) : null}

      {items.length === 0 ? (
        <Card className="text-center">
          <p className="mb-1 text-lg font-medium text-fg">No cards here yet</p>
          <p className="text-sm text-fg-muted">
            Use “Add a card” above, or browse the{" "}
            <Link to="/cards" className="text-accent hover:underline">
              catalog
            </Link>{" "}
            and add cards from their pages.
          </p>
        </Card>
      ) : view === "grid" ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {items.map((item) => (
            <li key={item.id} className="relative">
              <label className="absolute left-1.5 top-1.5 z-10 rounded bg-surface/90 p-1">
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => toggleSelected(item.id)}
                  aria-label={`Select ${item.cardName}`}
                />
              </label>
              <Link to={`/cards/${item.cardSlug}`} className="group flex flex-col gap-2">
                {item.imageSmallUrl ? (
                  <img
                    src={item.imageSmallUrl}
                    alt={`${item.cardName} card`}
                    loading="lazy"
                    className="aspect-[63/88] w-full rounded-lg border border-edge object-cover group-hover:border-accent"
                  />
                ) : (
                  <span className="flex aspect-[63/88] items-center justify-center rounded-lg border border-edge bg-surface-raised text-xs text-fg-faint">
                    No image
                  </span>
                )}
              </Link>
              <p className="mt-1 truncate text-xs font-medium text-fg">
                {item.cardName} ×{item.quantity}
              </p>
              <p className="text-xs text-fg-faint">
                {item.currentPriceMinor !== null
                  ? formatMinor(item.currentPriceMinor * item.quantity)
                  : "unpriced"}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-(--radius-card) border border-edge bg-surface">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Your collection entries</caption>
            <thead>
              <tr className="border-b border-edge text-fg-muted">
                <th scope="col" className="p-3">
                  <span className="sr-only">Select</span>
                </th>
                <th scope="col" className="p-3">
                  Card
                </th>
                <th scope="col" className="p-3">
                  Variant
                </th>
                <th scope="col" className="p-3">
                  Cond.
                </th>
                <th scope="col" className="p-3">
                  Qty
                </th>
                <th scope="col" className="p-3">
                  Paid
                </th>
                <th scope="col" className="p-3">
                  Value
                </th>
                <th scope="col" className="p-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <EntryRow
                  key={item.id}
                  item={item}
                  selected={selected.has(item.id)}
                  onToggle={() => toggleSelected(item.id)}
                  editing={editingId === item.id}
                  onEdit={() => setEditingId(editingId === item.id ? null : item.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-center gap-2">
          {page > 1 ? (
            <Link
              to={linkWith({ page: String(page - 1) })}
              className="rounded-lg border border-edge px-4 py-2 text-sm"
            >
              ← Previous
            </Link>
          ) : null}
          <span className="px-2 text-sm text-fg-muted">
            Page {page} / {pageCount}
          </span>
          {page < pageCount ? (
            <Link
              to={linkWith({ page: String(page + 1) })}
              className="rounded-lg border border-edge px-4 py-2 text-sm"
            >
              Next →
            </Link>
          ) : null}
        </nav>
      ) : null}

      <p className="text-xs text-fg-faint">
        Values are estimated raw-card market prices for the selected variant and may not reflect
        your card's exact condition. Unpriced entries are never counted as $0.
      </p>
    </div>
  );
}

function EntryRow({
  item,
  selected,
  onToggle,
  editing,
  onEdit,
}: {
  item: Item;
  selected: boolean;
  onToggle: () => void;
  editing: boolean;
  onEdit: () => void;
}) {
  return (
    <>
      <tr className="border-b border-edge/50">
        <td className="p-3">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`Select ${item.cardName}`}
          />
        </td>
        <td className="p-3">
          <Link to={`/cards/${item.cardSlug}`} className="font-medium text-fg hover:text-accent">
            {item.cardName}
          </Link>
          <p className="text-xs text-fg-faint">
            {item.setName} · #{item.cardNumber}
          </p>
        </td>
        <td className="p-3 text-fg-muted">
          {item.variant}
          {item.grade !== "raw" ? (
            <span className="ms-1 rounded bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent-strong">
              {GRADE_LABELS[item.grade]}
            </span>
          ) : null}
        </td>
        <td className="p-3 text-fg-muted">{item.condition}</td>
        <td className="p-3">{item.quantity}</td>
        <td className="p-3 text-fg-muted">
          {item.purchasePriceMinor !== null
            ? formatMinor(item.purchasePriceMinor * item.quantity)
            : "—"}
        </td>
        <td className="p-3 font-medium">
          {item.currentPriceMinor !== null ? (
            formatMinor(item.currentPriceMinor * item.quantity)
          ) : (
            <span className="text-fg-faint">unpriced</span>
          )}
        </td>
        <td className="p-3">
          <button
            type="button"
            onClick={onEdit}
            aria-expanded={editing}
            className="text-sm font-medium text-accent hover:underline"
          >
            {editing ? "Close" : "Edit"}
          </button>
        </td>
      </tr>
      {editing ? (
        <tr className="border-b border-edge/50 bg-surface-raised">
          <td colSpan={8} className="p-4">
            <EntryForm
              intent="update"
              hidden={{ entryId: item.id }}
              defaults={{
                quantity: item.quantity,
                variant: item.variant,
                grade: item.grade,
                condition: item.condition,
                language: item.language,
                purchasePrice:
                  item.purchasePriceMinor !== null
                    ? (item.purchasePriceMinor / 100).toFixed(2)
                    : "",
                purchaseDate: item.purchaseDate ?? "",
                notes: item.notes ?? "",
              }}
              submitLabel="Save entry"
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

interface SearchResult {
  id: string;
  name: string;
  setName?: string | null;
  number: string;
  imageSmallUrl: string | null;
  variants: string[];
}

function AddCardPanel() {
  const fetcher = useFetcher<{ items: SearchResult[] }>();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<SearchResult | null>(null);
  const [hasQuery, setHasQuery] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, []);

  function onSearchChange(value: string) {
    setHasQuery(value.trim().length >= 2);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      if (value.trim().length >= 2) {
        void fetcher.load(`/app/collection/search?q=${encodeURIComponent(value)}`);
      }
    }, 250);
  }

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-lg font-semibold text-fg">+ Add a card</span>
        <span aria-hidden="true" className="text-fg-muted">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open ? (
        <div className="mt-4 flex flex-col gap-4">
          {!picked ? (
            <>
              <div className="flex flex-col gap-1">
                <label htmlFor="add-search" className="text-sm font-medium text-fg">
                  Search the catalog
                </label>
                <input
                  id="add-search"
                  type="search"
                  placeholder="e.g. Charizard base…"
                  onChange={(e) => onSearchChange(e.target.value)}
                  className="min-h-11 rounded-lg border border-edge bg-surface px-3 text-fg"
                />
              </div>
              {fetcher.state === "loading" ? (
                <div className="skeleton h-16 w-full" aria-hidden="true" />
              ) : null}
              {fetcher.data && fetcher.data.items.length > 0 ? (
                <ul className="flex flex-col gap-1" role="listbox" aria-label="Search results">
                  {fetcher.data.items.map((card) => (
                    <li key={card.id}>
                      <button
                        type="button"
                        onClick={() => setPicked(card)}
                        className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-surface-raised"
                      >
                        {card.imageSmallUrl ? (
                          <img
                            src={card.imageSmallUrl}
                            alt=""
                            className="h-12 w-9 rounded border border-edge object-cover"
                          />
                        ) : null}
                        <span>
                          <span className="font-medium text-fg">{card.name}</span>{" "}
                          <span className="text-sm text-fg-faint">
                            {card.setName} · #{card.number}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : fetcher.data && hasQuery ? (
                <p className="text-sm text-fg-muted">No matching cards.</p>
              ) : null}
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <p className="font-medium text-fg">
                  {picked.name}{" "}
                  <span className="text-sm text-fg-faint">
                    {picked.setName} · #{picked.number}
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() => setPicked(null)}
                  className="text-sm text-accent hover:underline"
                >
                  Choose another card
                </button>
              </div>
              <EntryForm
                intent="add"
                hidden={{ cardId: picked.id }}
                defaults={{
                  quantity: 1,
                  variant: picked.variants[0] ?? "normal",
                  grade: "raw",
                  condition: "Near Mint",
                  language: "English",
                  purchasePrice: "",
                  purchaseDate: "",
                  notes: "",
                }}
                variantOptions={picked.variants.length > 0 ? picked.variants : undefined}
                submitLabel="Add to collection"
                onSubmitted={() => setPicked(null)}
              />
            </div>
          )}
        </div>
      ) : null}
    </Card>
  );
}

function EntryForm({
  intent,
  hidden,
  defaults,
  variantOptions,
  submitLabel,
  onSubmitted,
}: {
  intent: "add" | "update";
  hidden: Record<string, string>;
  defaults: {
    quantity: number;
    variant: string;
    grade: string;
    condition: string;
    language: string;
    purchasePrice: string;
    purchaseDate: string;
    notes: string;
  };
  variantOptions?: string[];
  submitLabel: string;
  onSubmitted?: () => void;
}) {
  const variants = variantOptions ?? [...VARIANTS];
  return (
    <Form method="post" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={onSubmitted}>
      <input type="hidden" name="intent" value={intent} />
      {Object.entries(hidden).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <Input
        label="Quantity"
        id={`${intent}-qty`}
        name="quantity"
        type="number"
        min={1}
        max={10000}
        defaultValue={defaults.quantity}
        required
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${intent}-variant`} className="text-sm font-medium text-fg">
          Variant
        </label>
        <select
          id={`${intent}-variant`}
          name="variant"
          defaultValue={defaults.variant}
          className="min-h-11 rounded-lg border border-edge bg-surface px-3 text-fg"
        >
          {variants.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        {variantOptions ? (
          <p className="text-xs text-fg-faint">Variants with market price data for this card.</p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${intent}-grade`} className="text-sm font-medium text-fg">
          Grade
        </label>
        <select
          id={`${intent}-grade`}
          name="grade"
          defaultValue={defaults.grade}
          className="min-h-11 rounded-lg border border-edge bg-surface px-3 text-fg"
        >
          {GRADES.map((g) => (
            <option key={g} value={g}>
              {GRADE_LABELS[g]}
            </option>
          ))}
        </select>
        <p className="text-xs text-fg-faint">PSA prices use eBay lowest listing.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${intent}-condition`} className="text-sm font-medium text-fg">
          Condition
        </label>
        <select
          id={`${intent}-condition`}
          name="condition"
          defaultValue={defaults.condition}
          className="min-h-11 rounded-lg border border-edge bg-surface px-3 text-fg"
        >
          {CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <Input
        label="Language"
        id={`${intent}-lang`}
        name="language"
        defaultValue={defaults.language}
        maxLength={40}
      />
      <Input
        label="Purchase price (USD, per card)"
        id={`${intent}-price`}
        name="purchasePrice"
        inputMode="decimal"
        placeholder="e.g. 12.50"
        defaultValue={defaults.purchasePrice}
        hint="Optional — unlocks profit/loss tracking."
      />
      <Input
        label="Purchase date"
        id={`${intent}-date`}
        name="purchaseDate"
        type="date"
        defaultValue={defaults.purchaseDate}
      />
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label htmlFor={`${intent}-notes`} className="text-sm font-medium text-fg">
          Notes (plain text)
        </label>
        <textarea
          id={`${intent}-notes`}
          name="notes"
          defaultValue={defaults.notes}
          maxLength={LIMITS.maxNotesLength}
          rows={2}
          className="rounded-lg border border-edge bg-surface px-3 py-2 text-fg"
        />
      </div>
      <div className="sm:col-span-2 lg:col-span-4">
        <Button type="submit">{submitLabel}</Button>
      </div>
    </Form>
  );
}
