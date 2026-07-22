/**
 * Chart.js canvas renderer — the ONLY module that pulls in chart.js +
 * react-chartjs-2 (~170 KB). It is loaded lazily (React.lazy) by HistoryChart
 * *after* hydration, so this heavy dependency never sits in the card/dashboard/
 * compare route's critical JS. Server render shows a skeleton (HistoryChart owns
 * the SSR fallback); this component only ever runs client-side.
 */
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
import { Line } from "react-chartjs-2";

import type { HistoryPoint } from "./history-chart";
import { formatMinor } from "~/lib/money/decimal";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler, TimeScale);

export default function HistoryChartCanvas({
  points,
  title,
  currency,
  accentColor,
  summary,
}: {
  points: HistoryPoint[];
  title: string;
  currency: "USD" | "EUR";
  accentColor: string;
  summary: string;
}) {
  return (
    <Line
      aria-label={summary}
      data={{
        labels: points.map((p) => p.date),
        datasets: [
          {
            label: title,
            data: points.map((p) => p.valueMinor / 100),
            borderColor: accentColor,
            // Same color with alpha — computed oklch(…) → oklch(… / 0.15).
            backgroundColor: accentColor.replace(/\)\s*$/, " / 0.15)"),
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
              label: (item) => formatMinor(Math.round((item.parsed.y ?? 0) * 100), currency),
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
  );
}
