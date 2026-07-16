/**
 * Pokector brand mark. Original geometric design: 3×3 binder-pocket grid with one
 * highlighted card slot and a portfolio trend line. Do not replace with any
 * franchise or third-party imagery (docs/SPEC.md §5).
 */

export function PokectorIcon({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" className="fill-ink-900 dark:fill-ink-800" />
      <g className="fill-ink-700" opacity="0.85">
        <rect x="8" y="7" width="12" height="14" rx="2.5" />
        <rect x="26" y="7" width="12" height="14" rx="2.5" />
        <rect x="44" y="7" width="12" height="14" rx="2.5" />
        <rect x="8" y="25" width="12" height="14" rx="2.5" />
        <rect x="26" y="25" width="12" height="14" rx="2.5" />
        <rect x="8" y="43" width="12" height="14" rx="2.5" />
        <rect x="26" y="43" width="12" height="14" rx="2.5" />
        <rect x="44" y="43" width="12" height="14" rx="2.5" />
      </g>
      <rect x="44" y="25" width="12" height="14" rx="2.5" className="fill-mint-500" />
      <path
        d="M11 52.5 L18 46 L29 49 L37 41 L47 44 L53 33.5"
        fill="none"
        className="stroke-coral-500"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
