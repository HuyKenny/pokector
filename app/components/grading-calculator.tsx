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

export interface GradedValue {
  /** Display label, e.g. "PSA 10". */
  label: string;
  /** Graded market value, USD cents (median of sold comps, or lowest listing). */
  valueMinor: number;
  /** Whether valueMinor is real sold comps or just the lowest active listing. */
  source: "sold" | "listing";
}

export interface GradingLabels {
  heading: string;
  tierLabel: string;
  tierValue: string;
  tierRegular: string;
  tierExpress: string;
  rawCostLabel: string;
  colGrade: string;
  colGradedValue: string;
  colAllIn: string;
  colNet: string;
  colRoi: string;
  worthIt: string;
  notWorth: string;
  soldNote: string;
  listingDisclaimer: string;
  feeNote: string; // "PSA fee {fee} + shipping {shipping} (estimate)"
}

const TIER_LABEL_KEY: Record<
  GradingTierId,
  keyof Pick<GradingLabels, "tierValue" | "tierRegular" | "tierExpress">
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
 * "Is it worth grading?" — break-even estimate for sending a raw card to PSA.
 * Compares each available graded median against raw cost + PSA fee + shipping.
 * Client-only (interactive inputs); all math in USD (the graded market currency).
 */
export function GradingCalculator({
  rawMinor,
  grades,
  langTag,
  labels,
}: {
  rawMinor: number;
  grades: GradedValue[];
  langTag: string;
  labels: GradingLabels;
}) {
  const [tierId, setTierId] = useState<GradingTierId>(DEFAULT_GRADING_TIER);
  const [rawCostStr, setRawCostStr] = useState<string>((rawMinor / 100).toFixed(2));

  const tier = gradingTier(tierId);
  const rawCostMinor = parseMoneyMinor(rawCostStr) ?? rawMinor;
  const usd = (minor: number) => formatMinor(minor, "USD", langTag);
  const anyListingOnly = grades.some((g) => g.source === "listing");

  return (
    <section
      aria-labelledby="grading-calc-heading"
      className="flex flex-col gap-4 rounded-(--radius-card) border border-edge bg-surface p-5"
    >
      <h2 id="grading-calc-heading" className="font-semibold text-fg">
        {labels.heading}
      </h2>

      <div className="flex flex-wrap items-end gap-4">
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

        <div className="flex flex-col gap-1">
          <label htmlFor="grading-raw-cost" className="text-sm font-medium text-fg">
            {labels.rawCostLabel}
          </label>
          <input
            id="grading-raw-cost"
            type="text"
            inputMode="decimal"
            value={rawCostStr}
            onChange={(e) => setRawCostStr(e.target.value)}
            className="min-h-9 w-28 rounded-lg border border-edge bg-canvas px-3 text-sm text-fg"
          />
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
            {grades.map((g) => {
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
                      title={roi.worthIt ? labels.worthIt : labels.notWorth}
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
      <p className="text-xs text-fg-faint">
        {anyListingOnly ? labels.listingDisclaimer : labels.soldNote}
      </p>
    </section>
  );
}
