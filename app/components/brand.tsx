/**
 * Pokector brand mark (2026-07 redesign, owner-approved — see docs/BRAND.md).
 * Original geometric design: a circular "collector's coin" split by a RISING
 * price-chart line into a crimson upper half and a light lower half, with an
 * off-center data-point dot. Evokes the hobby's red/white ball colors and a
 * market chart at once, but is deliberately NOT a Poké Ball: no horizontal
 * band, no centered button — do not "fix" it toward the franchise shape
 * (docs/SPEC.md §5). Keep app/components/brand.tsx, public/brand/*.svg and
 * scripts/gen-brand-assets.mjs geometry in sync.
 */

export function PokectorIcon({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" className="fill-ink-950" />
      <clipPath id="pokector-coin">
        <circle cx="32" cy="32" r="21" />
      </clipPath>
      <g clipPath="url(#pokector-coin)">
        <rect width="64" height="64" className="fill-paper-100" />
        {/* Upper region above the rising chart line. */}
        <path d="M0 0 H64 V16 L38 28 L28 40 L20 36 L0 48 Z" className="fill-crimson-500" />
        {/* The chart line itself divides the coin. */}
        <path
          d="M0 48 L20 36 L28 40 L38 28 L64 16"
          fill="none"
          className="stroke-ink-950"
          strokeWidth="4"
          strokeLinejoin="round"
        />
      </g>
      <circle cx="32" cy="32" r="21" fill="none" className="stroke-ink-950" strokeWidth="3.5" />
      {/* Data point on the chart line — off-center by design. */}
      <circle cx="38" cy="28" r="4.5" className="fill-spark-400 stroke-ink-950" strokeWidth="2" />
    </svg>
  );
}

export function PokectorWordmark({ className = "h-8" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <PokectorIcon className="h-full w-auto" />
      <span className="text-xl font-bold tracking-tight text-fg">
        Pok<span className="text-accent">ector</span>
      </span>
    </span>
  );
}
