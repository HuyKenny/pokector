import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LinearScale,
  LineElement,
  PointElement,
  TimeScale,
  Tooltip,
} from "chart.js";
import { useId, useMemo, useState, useSyncExternalStore } from "react";
import { Line } from "react-chartjs-2";

import { formatMinor } from "~/lib/money/decimal";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler, TimeScale);

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
                  ? "bg-accent text-white"
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
              <Line
                aria-label={summary}
                data={{
                  labels: points.map((p) => p.date),
                  datasets: [
                    {
                      label: title,
                      data: points.map((p) => p.valueMinor / 100),
                      borderColor: "oklch(0.6 0.12 168)",
                      backgroundColor: "oklch(0.6 0.12 168 / 0.15)",
                      fill: true,
                      pointRadius: points.length === 1 ? 5 : points.length > 60 ? 0 : 2,
                      tension: 0.15,
                      stepped: false,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  interaction: { mode: "index", intersect: false },
                  plugins: {
                    tooltip: {
                      callbacks: {
                        label: (item) =>
                          formatMinor(Math.round((item.parsed.y ?? 0) * 100), currency),
                      },
                    },
                  },
                  scales: {
                    y: {
                      ticks: {
                        callback: (value) => formatMinor(Math.round(Number(value) * 100), currency),
                      },
                    },
                    x: { ticks: { maxTicksLimit: 8 } },
                  },
                }}
              />
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
              <table className="w-full text-left text-sm">
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
