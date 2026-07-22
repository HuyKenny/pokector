import { lazy, Suspense, useId, useMemo, useState, useSyncExternalStore } from "react";

import { formatMinor } from "~/lib/money/decimal";

// chart.js (~170 KB) lives in this lazily-loaded chunk — never in the route's
// critical JS. It only mounts client-side after hydration (see `mounted`).
const HistoryChartCanvas = lazy(() => import("./history-chart-canvas"));

export interface HistoryPoint {
  /** "YYYY-MM-DD" */
  date: string;
  /** integer minor units */
  valueMinor: number;
}

export const CHART_RANGES = ["7D", "1M", "3M", "6M", "1Y", "MAX"] as const;
export type ChartRange = (typeof CHART_RANGES)[number];

export function rangeStartDate(range: ChartRange, now = new Date()): string | null {
  const days: Record<Exclude<ChartRange, "MAX">, number> = {
    "7D": 7,
    "1M": 30,
    "3M": 91,
    "6M": 182,
    "1Y": 365,
  };
  if (range === "MAX") return null;
  return new Date(now.getTime() - days[range] * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Carry the last known value forward so sparse observations chart cleanly. */
export function carryForward(points: HistoryPoint[], endDate: string): HistoryPoint[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1];
  if (last.date < endDate) sorted.push({ date: endDate, valueMinor: last.valueMinor });
  return sorted;
}

/**
 * Accessible time-series chart: keyboard-reachable range controls, a text
 * summary, and a data-table alternative (SPEC §5). Client-rendered only —
 * server renders the accessible fallback.
 */
export function HistoryChart({
  title,
  points,
  currency = "USD",
  range,
  onRangeChange,
  emptyMessage,
  startNote,
}: {
  title: string;
  points: HistoryPoint[];
  currency?: "USD" | "EUR";
  range: ChartRange;
  onRangeChange: (range: ChartRange) => void;
  emptyMessage: string;
  startNote?: string | null;
}) {
  // True only after hydration — Chart.js needs a real canvas (no SSR).
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [showTable, setShowTable] = useState(false);
  const headingId = useId();

  // Chart.js paints to <canvas> and cannot resolve CSS variables itself, so
  // read the brand accent token once the component is mounted (the chart only
  // renders client-side; the SSR fallback needs no colors). Re-read on theme
  // class changes so a live theme switch recolors the line.
  const accentColor = useSyncExternalStore(
    (onChange) => {
      const observer = new MutationObserver(onChange);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      return () => observer.disconnect();
    },
    () => getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim(),
    () => "",
  );

  const summary = useMemo(() => {
    if (points.length === 0) return emptyMessage;
    const first = points[0];
    const last = points[points.length - 1];
    const change = last.valueMinor - first.valueMinor;
    const pct = first.valueMinor > 0 ? ((change / first.valueMinor) * 100).toFixed(1) : null;
    if (points.length === 1) {
      return `${title}: single observation of ${formatMinor(first.valueMinor, currency)} on ${first.date}.`;
    }
    return `${title}: from ${formatMinor(first.valueMinor, currency)} on ${first.date} to ${formatMinor(
      last.valueMinor,
      currency,
    )} on ${last.date} (${change >= 0 ? "+" : ""}${formatMinor(change, currency)}${pct ? `, ${change >= 0 ? "+" : ""}${pct}%` : ""}).`;
  }, [points, title, currency, emptyMessage]);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="font-semibold text-fg">
          {title}
        </h3>
        <div role="group" aria-label="Chart time range" className="flex gap-1">
          {CHART_RANGES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onRangeChange(option)}
              aria-pressed={range === option}
              className={`min-h-9 rounded-md px-2.5 text-xs font-medium ${
                range === option
                  ? "bg-accent text-(color:--color-on-accent)"
                  : "border border-edge text-fg-muted hover:text-fg"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <p className="sr-only" role="status">
        {summary}
      </p>
      {startNote ? <p className="text-xs text-fg-faint">{startNote}</p> : null}

      {points.length === 0 ? (
        <div className="flex h-48 items-center justify-center rounded-lg border border-edge bg-surface-raised text-sm text-fg-muted">
          {emptyMessage}
        </div>
      ) : (
        <>
          <div className="h-56" aria-hidden={!mounted}>
            {mounted ? (
              <Suspense fallback={<div className="skeleton h-full w-full" aria-hidden="true" />}>
                <HistoryChartCanvas
                  points={points}
                  title={title}
                  currency={currency}
                  accentColor={accentColor}
                  summary={summary}
                />
              </Suspense>
            ) : (
              <div className="skeleton h-full w-full" aria-hidden="true" />
            )}
          </div>
          <p aria-hidden="true" className="text-xs text-fg-muted">
            {summary}
          </p>
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            aria-expanded={showTable}
            className="self-start text-xs font-medium text-accent hover:underline"
          >
            {showTable ? "Hide data table" : "Show data table"}
          </button>
          {showTable ? (
            <div className="max-h-64 overflow-auto rounded-lg border border-edge">
              <table className="w-full text-start text-sm">
                <caption className="sr-only">{title} — data table</caption>
                <thead className="sticky top-0 bg-surface-raised">
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Date
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((point) => (
                    <tr key={point.date} className="border-t border-edge/50">
                      <td className="px-3 py-1.5">{point.date}</td>
                      <td className="px-3 py-1.5">{formatMinor(point.valueMinor, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
