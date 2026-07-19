import { Link } from "react-router";

import type { Route } from "./+types/sales";
import { Card } from "~/components/ui";
import { requireUser } from "~/lib/auth/guards.server";
import { listSales, summarizeSales, type SaleRow } from "~/lib/collection/sales.server";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { formatMinor, formatPercent } from "~/lib/money/decimal";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Sales & realized P/L — Pokector" }, { name: "robots", content: "noindex" }];
}

const GRADE_LABELS: Record<SaleRow["grade"], string> = {
  raw: "Raw",
  psa9: "PSA 9",
  psa10: "PSA 10",
};

const money = (minor: number) => formatMinor(minor);
const dec = (minor: number | null) => (minor === null ? "" : (minor / 100).toFixed(2));

/** RFC-4180-ish CSV cell (quote when it contains a comma, quote, or newline). */
function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function salesCsv(sales: SaleRow[]): string {
  const header = [
    "sold_date",
    "card",
    "set",
    "number",
    "variant",
    "grade",
    "quantity",
    "sale_price_per_card_usd",
    "fees_usd",
    "purchase_price_per_card_usd",
    "proceeds_usd",
    "realized_pl_usd",
    "notes",
  ];
  const rows = sales.map((s) =>
    [
      s.soldDate,
      s.cardName,
      s.setName,
      s.cardNumber,
      s.variant,
      GRADE_LABELS[s.grade],
      String(s.quantity),
      dec(s.salePriceMinor),
      dec(s.feeMinor),
      dec(s.purchasePriceMinor),
      dec(s.proceedsMinor),
      dec(s.realizedPlMinor),
      s.notes ?? "",
    ]
      .map((v) => csvCell(String(v)))
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const url = new URL(request.url);
  const yearParam = url.searchParams.get("year");
  const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null;

  const all = await listSales(db, session.user.id);
  const years = [...new Set(all.map((s) => s.soldDate.slice(0, 4)))].sort().reverse();
  const sales = year ? all.filter((s) => s.soldDate.slice(0, 4) === String(year)) : all;

  if (url.searchParams.get("format") === "csv") {
    return new Response(salesCsv(sales), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="pokector-sales${year ? `-${year}` : ""}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  return { sales, summary: summarizeSales(sales), year, years };
}

export default function Sales({ loaderData }: Route.ComponentProps) {
  const { sales, summary, year, years } = loaderData;
  const roiPercent =
    summary.costBasisMinor > 0 ? (summary.realizedPlMinor / summary.costBasisMinor) * 100 : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-fg">Sales &amp; realized P/L</h1>
        {sales.length > 0 ? (
          <a
            href={`/app/sales?format=csv${year ? `&year=${year}` : ""}`}
            className="min-h-11 rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg hover:bg-surface-raised"
          >
            Export CSV
          </a>
        ) : null}
      </div>

      {years.length > 0 ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by year">
          <YearChip label="All time" to="/app/sales" active={year === null} />
          {years.map((y) => (
            <YearChip
              key={y}
              label={y}
              to={`/app/sales?year=${y}`}
              active={year === Number(y)}
            />
          ))}
        </div>
      ) : null}

      {sales.length === 0 ? (
        <Card className="text-center">
          <p className="mb-1 text-lg font-medium text-fg">No sales recorded yet</p>
          <p className="mx-auto max-w-md text-sm text-fg-muted">
            When you sell a card, open{" "}
            <Link to="/app/collection" className="text-accent hover:underline">
              your collection
            </Link>{" "}
            and choose <strong>Sell</strong> on its row. Recorded sales show your realized profit or
            loss here and can be exported for tax season.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Realized P/L"
              value={money(summary.realizedPlMinor)}
              tone={summary.realizedPlMinor >= 0 ? "positive" : "negative"}
              sub={roiPercent !== null ? `${formatPercent(roiPercent)} on cost basis` : undefined}
            />
            <StatCard label="Proceeds (net of fees)" value={money(summary.proceedsMinor)} />
            <StatCard label="Cost basis" value={money(summary.costBasisMinor)} />
            <StatCard
              label="Cards sold"
              value={summary.totalQuantity.toLocaleString("en-US")}
              sub={`${summary.salesCount} ${summary.salesCount === 1 ? "sale" : "sales"}`}
            />
          </div>

          {summary.unpricedCount > 0 ? (
            <p className="text-xs text-fg-faint">
              {summary.unpricedCount}{" "}
              {summary.unpricedCount === 1 ? "sale is" : "sales are"} excluded from realized P/L
              because no purchase price was recorded on the entry.
            </p>
          ) : null}

          <div className="overflow-x-auto rounded-(--radius-card) border border-edge bg-surface">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Your recorded sales</caption>
              <thead>
                <tr className="border-b border-edge text-fg-muted">
                  <th scope="col" className="p-3">
                    Date
                  </th>
                  <th scope="col" className="p-3">
                    Card
                  </th>
                  <th scope="col" className="p-3">
                    Qty
                  </th>
                  <th scope="col" className="p-3 text-end">
                    Sale / card
                  </th>
                  <th scope="col" className="p-3 text-end">
                    Cost / card
                  </th>
                  <th scope="col" className="p-3 text-end">
                    Proceeds
                  </th>
                  <th scope="col" className="p-3 text-end">
                    Realized P/L
                  </th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.id} className="border-b border-edge/50">
                    <td className="p-3 tabular-nums text-fg-muted">{s.soldDate}</td>
                    <td className="p-3">
                      <Link
                        to={`/cards/${s.cardSlug}`}
                        className="font-medium text-fg hover:text-accent"
                      >
                        {s.cardName}
                      </Link>
                      <p className="text-xs text-fg-faint">
                        {s.setName} · #{s.cardNumber} · {s.variant}
                        {s.grade !== "raw" ? ` · ${GRADE_LABELS[s.grade]}` : ""}
                      </p>
                    </td>
                    <td className="p-3">{s.quantity}</td>
                    <td className="p-3 text-end tabular-nums">{money(s.salePriceMinor)}</td>
                    <td className="p-3 text-end tabular-nums text-fg-muted">
                      {s.purchasePriceMinor !== null ? money(s.purchasePriceMinor) : "—"}
                    </td>
                    <td className="p-3 text-end tabular-nums">{money(s.proceedsMinor)}</td>
                    <td
                      className={`p-3 text-end font-medium tabular-nums ${
                        s.realizedPlMinor === null
                          ? "text-fg-faint"
                          : s.realizedPlMinor >= 0
                            ? "text-positive"
                            : "text-negative"
                      }`}
                    >
                      {s.realizedPlMinor === null
                        ? "—"
                        : `${s.realizedPlMinor >= 0 ? "+" : ""}${money(s.realizedPlMinor)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-fg-faint">
            Realized P/L uses the purchase price recorded on each entry as its cost basis, snapshotted
            at the time of sale. Values are in USD. This is not tax or financial advice.
          </p>
        </>
      )}
    </div>
  );
}

function YearChip({ label, to, active }: { label: string; to: string; active: boolean }) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={`rounded-full px-4 py-1.5 text-sm font-medium ${
        active
          ? "bg-accent text-(color:--color-on-accent)"
          : "border border-edge text-fg-muted hover:text-fg"
      }`}
    >
      {label}
    </Link>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "positive" | "negative";
}) {
  return (
    <Card className="!p-4">
      <p className="text-xs uppercase tracking-wide text-fg-muted">{label}</p>
      <p
        className={`text-2xl font-bold ${
          tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-fg"
        }`}
      >
        {value}
      </p>
      {sub ? <p className="mt-1 text-xs text-fg-faint">{sub}</p> : null}
    </Card>
  );
}
