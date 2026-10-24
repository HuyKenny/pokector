import { useState } from "react";

import {
  computeGradingRoi,
  DEFAULT_GRADING_TIER,
  GRADING_SHIPPING_MINOR,
  GRADING_TIERS,
  gradingTier,
  type GradingTierId,
} from "~/lib/grading/fees";
import { formatMinor } from "~/lib/money/decimal";

export interface StandaloneGradingLabels {
  tierLabel: string;
  tierValue: string;
  tierRegular: string;
  tierExpress: string;
  rawLabel: string;
  psa9Label: string;
  psa10Label: string;
  colGrade: string;
  colGradedValue: string;
  colAllIn: string;
  colNet: string;
  colRoi: string;
  feeNote: string; // "PSA fee {fee} + shipping {shipping} (estimate)"
  disclaimer: string;
}

const TIER_LABEL_KEY: Record<
  GradingTierId,
  keyof Pick<StandaloneGradingLabels, "tierValue" | "tierRegular" | "tierExpress">
> = {
  value: "tierValue",
  regular: "tierRegular",
  express: "tierExpress",
};

/** Parse a user-typed money string ("12.50", "12,50", "$12") into USD cents. */
function parseMoneyMinor(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.,]/g, "").replace(",", ".");
  if (!cleaned) return null;
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
}

/**
 * Fully interactive "is grading worth it?" calculator for the standalone landing
 * page. Every number is user-entered (raw + PSA 9 + PSA 10) — nothing is
 * presented as real market data. Math in USD (the graded market currency),
 * reusing the same fee model as the on-card calculator.
 */
export function StandaloneGradingCalculator({
  langTag,
  labels,
}: {
  langTag: string;
  labels: StandaloneGradingLabels;
}) {
  const [tierId, setTierId] = useState<GradingTierId>(DEFAULT_GRADING_TIER);
  // Illustrative defaults — the user overrides them with their own card's numbers.
  const [rawStr, setRawStr] = useState("20");
  const [psa9Str, setPsa9Str] = useState("60");
  const [psa10Str, setPsa10Str] = useState("150");

  const tier = gradingTier(tierId);
  const rawCostMinor = parseMoneyMinor(rawStr) ?? 0;
  const usd = (minor: number) => formatMinor(minor, "USD", langTag);

  const rows = [
    { label: "PSA 9", valueMinor: parseMoneyMinor(psa9Str) },
    { label: "PSA 10", valueMinor: parseMoneyMinor(psa10Str) },
  ].filter((r): r is { label: string; valueMinor: number } => r.valueMinor !== null);

  const inputs: { id: string; label: string; value: string; set: (v: string) => void }[] = [
    { id: "grade-raw", label: labels.rawLabel, value: rawStr, set: setRawStr },
    { id: "grade-psa9", label: labels.psa9Label, value: psa9Str, set: setPsa9Str },
    { id: "grade-psa10", label: labels.psa10Label, value: psa10Str, set: setPsa10Str },
  ];

  return (
    <section
      aria-labelledby="grading-calc-heading"
      className="flex flex-col gap-4 rounded-(--radius-card) border border-edge bg-surface p-5"
    >
      <div className="flex flex-wrap items-end gap-4">
        {inputs.map((field) => (
          <div key={field.id} className="flex flex-col gap-1">
            <label htmlFor={field.id} className="text-sm font-medium text-fg">
              {field.label}
            </label>
            <input
              id={field.id}
              type="text"
              inputMode="decimal"
              value={field.value}
              onChange={(e) => field.set(e.target.value)}
              className="min-h-9 w-28 rounded-lg border border-edge bg-canvas px-3 text-sm text-fg"
            />
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-fg">{labels.tierLabel}</span>
          <div className="flex gap-1" role="group" aria-label={labels.tierLabel}>
            {GRADING_TIERS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTierId(t.id)}
                aria-pressed={tierId === t.id}
                className={`min-h-9 rounded-md px-3 text-xs font-medium ${
                  tierId === t.id
                    ? "bg-accent text-(color:--color-on-accent)"
                    : "border border-edge text-fg-muted hover:text-fg"
                }`}
              >
                {labels[TIER_LABEL_KEY[t.id]]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-edge text-fg-muted">
              <th scope="col" className="py-2 pe-4 text-start font-medium">
                {labels.colGrade}
              </th>
              <th scope="col" className="py-2 pe-4 text-end font-medium">
                {labels.colGradedValue}
              </th>
              <th scope="col" className="py-2 pe-4 text-end font-medium">
                {labels.colAllIn}
              </th>
              <th scope="col" className="py-2 pe-4 text-end font-medium">
                {labels.colNet}
              </th>
              <th scope="col" className="py-2 text-end font-medium">
                {labels.colRoi}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => {
              const roi = computeGradingRoi({
                rawCostMinor,
                gradedValueMinor: g.valueMinor,
                feeMinor: tier.feeMinor,
                shippingMinor: GRADING_SHIPPING_MINOR,
              });
              return (
                <tr key={g.label} className="border-b border-edge/50">
                  <th scope="row" className="py-2 pe-4 text-start font-medium text-fg">
                    {g.label}
                  </th>
                  <td className="py-2 pe-4 text-end tabular-nums">{usd(g.valueMinor)}</td>
                  <td className="py-2 pe-4 text-end tabular-nums text-fg-muted">
                    {usd(roi.totalCostMinor)}
                  </td>
                  <td
                    className={`py-2 pe-4 text-end font-semibold tabular-nums ${
                      roi.netMinor >= 0 ? "text-positive" : "text-negative"
                    }`}
                  >
                    {roi.netMinor >= 0 ? "+" : ""}
                    {usd(roi.netMinor)}
                  </td>
                  <td className="py-2 text-end">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                        roi.worthIt
                          ? "bg-positive/15 text-positive"
                          : "bg-negative/15 text-negative"
                      }`}
                    >
                      {roi.roiPercent !== null
                        ? `${roi.roiPercent >= 0 ? "+" : ""}${roi.roiPercent.toFixed(0)}%`
                        : "—"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-fg-faint">
        {labels.feeNote
          .replace("{fee}", usd(tier.feeMinor))
          .replace("{shipping}", usd(GRADING_SHIPPING_MINOR))}
      </p>
      <p className="text-xs text-fg-faint">{labels.disclaimer}</p>
    </section>
  );
}
