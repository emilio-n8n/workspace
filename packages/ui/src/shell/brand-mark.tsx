// biome-ignore-all lint/a11y/noSvgWithoutTitle: SVG décoratif, déjà masqué par aria-hidden.
import { useId } from "react";
import { cn } from "../cn.ts";

/**
 * Marque Workspace — un carreau arrondi « encre » avec un « W » géométrique.
 * Le glyphe est une seule forme : deux vallées et trois sommets, extrémités
 * arrondies, lisible de 20 px à 200 px. Le dégradé existe une seule fois pour
 * toute la suite ; les applications qui n'imposent pas de classes gardent le
 * gabarit 36 px du shell.
 */
export function BrandMark({ className }: { className?: string }) {
  const gradientId = `brand-mark-${useId().replaceAll(":", "")}`;
  return (
    <span aria-hidden className={cn("size-9 rounded-lg shadow-soft", className)}>
      <svg viewBox="0 0 32 32" className="size-full">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#101f1c" />
            <stop offset="0.55" stopColor="#14332b" />
            <stop offset="1" stopColor="#1d8a6b" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="8.5" fill={`url(#${gradientId})`} />
        <path
          d="M7.4 9.6 11.6 23l4.1-8.4 4.1 8.4 4.2-13.4"
          fill="none"
          stroke="#fff"
          strokeWidth="2.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
