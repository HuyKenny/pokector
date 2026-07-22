import { lazy, Suspense, useId, useMemo, useState, useSyncExternalStore } from "react";

import { formatMinor } from "~/lib/money/decimal";
import {
  CHART_RANGES,
  carryForward,
  rangeStartDate,
  type ChartRange,
  type HistoryPoint,
} from "~/components/history-chart";

// chart.js (~170 KB) is confined to this lazily-loaded chunk (client-only).
const MultiHistoryChartCanvas = lazy(() => import("./multi-history-chart-canvas"));

export interface CompareSeries {
  label: string;
  points: HistoryPoint[];
}

/** Distinct, theme-legible line colors (crimson accent, blue, amber). */
const SERIES_COLORS = ["oklch(0.6 0.2 24)", "oklch(0.6 0.16 250)", "oklch(0.72 0.16 75)"] as const;

export interface CompareChartLabels {
  rangeAria: string;
  showTable: string;
  hideTable: string;
  dateColumn: string;
  empty: string;
}

/**
 * Multi-series price-history chart for the compare page. Sibling of HistoryChart
 * (kept separate so the single-series card/dashboard charts stay untouched).
 * Aligns each series onto a shared, sorted date axis with carry-forward values
 * and keeps the accessible summary + per-series data table.
 */
export function MultiHistoryChart({
  series,
  currency = "USD",
  range,
  onRangeChange,
  labels,
}: {
  series: CompareSeries[];
  currency?: "USD" | "EUR";
  range: ChartRange;
  onRangeChange: (range: ChartRange) => void;
  labels: CompareChartLabels;
}) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [showTable, setShowTable] = useState(false);
  const headingId = useId();
  const today = new Date().toISOString().slice(0, 10);
  const sinceDate = rangeStartDate(range);

  // Align every series onto one sorted date axis. Each series carries its last
  // known value forward; dates before a series' first observation stay null
  // (Chart.js spanGaps joins across, the table shows a dash).
  const { axis, aligned } = useMemo(() => {
    const carried = series.map((s) =>
      carryForward(
        s.points.filter((p) => !sinceDate || p.date >= sinceDate),
        today,
      ),
    );
    const dateSet = new Set<string>();
    for (const pts of carried) for (const p of pts) dateSet.add(p.date);
    const axis = [...dateSet].sort((a, b) => a.localeCompare(b));
    const aligned = carried.map((points) => {
      let i = -1;
      let last: number | null = null;
      return axis.map((d) => {
        while (i + 1 < points.length && points[i + 1].date <= d) {
          i += 1;
          last = points[i].valueMinor;
        }
        // Only carry forward once the series has started.
        return points.length > 0 && points[0].date <= d ? last : null;
      });
    });
    return { axis, aligned };
  }, [series, sinceDate, today]);

  const summary = useMemo(
    () =>
      series
        .map((s) => {
          const pts = s.points.filter((p) => !sinceDate || p.date >= sinceDate);
          if (pts.length === 0) return `${s.label}: —`;
          const first = pts[0];
          const last = pts[pts.length - 1];
          const change = last.valueMinor - first.valueMinor;
          const pct = first.valueMinor > 0 ? ((change / first.valueMinor) * 100).toFixed(1) : null;
          return `${s.label}: ${formatMinor(first.valueMinor, currency)} → ${formatMinor(
            last.valueMinor,
            currency,
          )}${pct ? ` (${change >= 0 ? "+" : ""}${pct}%)` : ""}`;
        })
        .join(". "),
    [series, sinceDate, currency],
  );

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="sr-only">
          {summary}
        </h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {series.map((s, i) => (
            <li key={s.label} className="flex items-center gap-1.5 text-sm text-fg">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] }}
              />
              {s.label}
            </li>
          ))}
        </ul>
        <div role="group" aria-label={labels.rangeAria} className="flex gap-1">
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

      {axis.length === 0 ? (
        <div className="flex h-56 items-center justify-center rounded-lg border border-edge bg-surface-raised text-sm text-fg-muted">
          {labels.empty}
        </div>
      ) : (
        <>
          <div className="h-64" aria-hidden={!mounted}>
            {mounted ? (
              <Suspense fallback={<div className="skeleton h-full w-full" aria-hidden="true" />}>
                <MultiHistoryChartCanvas
                  axis={axis}
                  currency={currency}
                  summary={summary}
                  datasets={series.map((s, i) => ({
                    label: s.label,
                    data: aligned[i].map((v) => (v === null ? null : v / 100)),
                    borderColor: SERIES_COLORS[i % SERIES_COLORS.length],
                    backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length],
                  }))}
                />
              </Suspense>
            ) : (
              <div className="skeleton h-full w-full" aria-hidden="true" />
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            aria-expanded={showTable}
            className="self-start text-xs font-medium text-accent hover:underline"
          >
            {showTable ? labels.hideTable : labels.showTable}
          </button>
          {showTable ? (
            <div className="max-h-64 overflow-auto rounded-lg border border-edge">
              <table className="w-full text-start text-sm">
                <thead className="sticky top-0 bg-surface-raised">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-start">
                      {labels.dateColumn}
                    </th>
                    {series.map((s) => (
                      <th key={s.label} scope="col" className="px-3 py-2 text-end">
                        {s.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {axis.map((date, rowIdx) => (
                    <tr key={date} className="border-t border-edge/50">
                      <td className="px-3 py-1.5">{date}</td>
                      {series.map((s, i) => (
                        <td key={s.label} className="px-3 py-1.5 text-end tabular-nums">
                          {aligned[i][rowIdx] === null
                            ? "—"
                            : formatMinor(aligned[i][rowIdx], currency)}
                        </td>
                      ))}
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
