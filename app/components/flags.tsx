/**
 * Tiny inline SVG flags for the language + market switchers. Inline (not emoji)
 * because flag emoji don't render on Windows/Chrome, and not external because
 * the strict CSP blocks remote assets. Simplified but recognizable at ~20px.
 *
 * Keyed by locale (en uses the Union Jack, pt uses Brazil = pt-BR) plus the two
 * market regions (us, eu).
 */
import type { ReactNode } from "react";

/** Unit 5-point star, centred at 0,0, outer radius 1, pointing up. */
const STAR =
  "M0,-1 L0.2245,-0.309 L0.951,-0.309 L0.363,0.118 L0.5878,0.809 " +
  "L0,0.382 L-0.5878,0.809 L-0.363,0.118 L-0.951,-0.309 L-0.2245,-0.309 Z";

function Star({
  x,
  y,
  s,
  fill,
  rot = 0,
}: {
  x: number | string;
  y: number | string;
  s: number | string;
  fill: string;
  rot?: number | string;
}) {
  return <path d={STAR} fill={fill} transform={`translate(${x} ${y}) scale(${s}) rotate(${rot})`} />;
}

const FLAGS: Record<string, ReactNode> = {
  // English → Union Jack (simplified counterchange).
  en: (
    <>
      <rect width="24" height="16" fill="#012169" />
      <path d="M0,0 24,16 M24,0 0,16" stroke="#fff" strokeWidth="3.2" />
      <path d="M0,0 24,16 M24,0 0,16" stroke="#C8102E" strokeWidth="1.3" />
      <path d="M12,0 V16 M0,8 H24" stroke="#fff" strokeWidth="4" />
      <path d="M12,0 V16 M0,8 H24" stroke="#C8102E" strokeWidth="2.4" />
    </>
  ),
  de: (
    <>
      <rect width="24" height="16" fill="#000" />
      <rect y="5.33" width="24" height="5.34" fill="#D00" />
      <rect y="10.67" width="24" height="5.33" fill="#FFCE00" />
    </>
  ),
  fr: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <rect width="8" height="16" fill="#0055A4" />
      <rect x="16" width="8" height="16" fill="#EF4135" />
    </>
  ),
  es: (
    <>
      <rect width="24" height="16" fill="#C60B1E" />
      <rect y="4" width="24" height="8" fill="#FFC400" />
    </>
  ),
  ru: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <rect y="5.33" width="24" height="5.34" fill="#0039A6" />
      <rect y="10.67" width="24" height="5.33" fill="#D52B1E" />
    </>
  ),
  cs: (
    <>
      <rect width="24" height="8" fill="#fff" />
      <rect y="8" width="24" height="8" fill="#D7141A" />
      <path d="M0,0 L12,8 L0,16 Z" fill="#11457E" />
    </>
  ),
  // Portuguese → Brazil (pt-BR).
  pt: (
    <>
      <rect width="24" height="16" fill="#009C3B" />
      <path d="M12,2 L22,8 L12,14 L2,8 Z" fill="#FFDF00" />
      <circle cx="12" cy="8" r="3.1" fill="#002776" />
    </>
  ),
  ja: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <circle cx="12" cy="8" r="4.2" fill="#BC002D" />
    </>
  ),
  zh: (
    <>
      <rect width="24" height="16" fill="#DE2910" />
      <Star x="4.5" y="4.2" s="2.6" fill="#FFDE00" />
      <Star x="8.5" y="1.6" s="0.8" fill="#FFDE00" />
      <Star x="10" y="3.4" s="0.8" fill="#FFDE00" />
      <Star x="10" y="5.6" s="0.8" fill="#FFDE00" />
      <Star x="8.5" y="7.4" s="0.8" fill="#FFDE00" />
    </>
  ),
  vi: (
    <>
      <rect width="24" height="16" fill="#DA251D" />
      <Star x="12" y="8" s="4" fill="#FF0" />
    </>
  ),
  // Arabic → Saudi Arabia (green field + white sword; script omitted at this size).
  ar: (
    <>
      <rect width="24" height="16" fill="#006C35" />
      <rect x="3" y="10.5" width="18" height="1" rx="0.5" fill="#fff" />
      <rect x="3" y="4.5" width="10" height="2.6" rx="0.6" fill="#fff" opacity="0.9" />
    </>
  ),
  // Market regions.
  us: (
    <>
      <rect width="24" height="16" fill="#B22234" />
      {[1, 3, 5, 7, 9, 11].map((i) => (
        <rect key={i} y={i * (16 / 13)} width="24" height={16 / 13} fill="#fff" />
      ))}
      <rect width="10.5" height={(16 / 13) * 7} fill="#3C3B6E" />
      {[0, 1, 2].map((r) =>
        [0, 1, 2, 3].map((c) => (
          <circle key={`${r}-${c}`} cx={1.6 + c * 2.6} cy={1.4 + r * 2.5} r="0.45" fill="#fff" />
        )),
      )}
    </>
  ),
  eu: (
    <>
      <rect width="24" height="16" fill="#003399" />
      {Array.from({ length: 12 }).map((_, i) => {
        const a = (i * Math.PI) / 6;
        return <Star key={i} x={12 + 4.7 * Math.sin(a)} y={8 - 4.7 * Math.cos(a)} s="0.9" fill="#FFCC00" />;
      })}
    </>
  ),
};

/** Inline SVG flag for a locale ("en", "de", …) or market region ("us", "eu"). */
export function Flag({ code, className }: { code: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 16"
      className={className}
      role="img"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
    >
      {FLAGS[code] ?? null}
    </svg>
  );
}
