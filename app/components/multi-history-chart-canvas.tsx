/**
 * Chart.js canvas renderer for the multi-series compare chart — the ONLY module
 * pulling chart.js here. Lazily loaded by MultiHistoryChart after hydration so
 * chart.js stays out of the compare route's critical JS. Client-only.
 */
import {
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  TimeScale,
  Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";

import { formatMinor } from "~/lib/money/decimal";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, TimeScale);

export interface CanvasDataset {
  label: string;
  data: (number | null)[];
  borderColor: string;
  backgroundColor: string;
}

export default function MultiHistoryChartCanvas({
  axis,
  datasets,
  currency,
  summary,
}: {
  axis: string[];
  datasets: CanvasDataset[];
  currency: "USD" | "EUR";
  summary: string;
}) {
  return (
    <Line
      aria-label={summary}
      data={{
        labels: axis,
        datasets: datasets.map((d) => ({
          ...d,
          spanGaps: true,
          fill: false,
          pointRadius: 0,
          tension: 0.15,
        })),
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) =>
                `${item.dataset.label}: ${formatMinor(
                  Math.round((item.parsed.y ?? 0) * 100),
                  currency,
                )}`,
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
