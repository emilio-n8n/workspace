/** Icônes propres à l'éditeur de documents — même géométrie stroke 16 px que
 * les icônes du design system (`packages/ui/src/icons.tsx`). */

/** Plan du document : un sommaire de trois lignes. */
export function OutlineIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M3 4h10M3 8h7M3 12h9" />
    </svg>
  );
}

/** Mode focus : une page seule, sans l'interface alentour. */
export function FocusIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      <path d="M5.5 8h5" />
    </svg>
  );
}

/** Recherche dans le document. */
export function SearchIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.2 10.2 13.5 13.5" />
    </svg>
  );
}

/** Alignement du paragraphe : quatre variantes, même grille. */
function AlignIcon({ lines }: { lines: string[] }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      aria-hidden
    >
      {lines.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export function AlignLeftIcon() {
  return <AlignIcon lines={["M3 4h10", "M3 8h6", "M3 12h10"]} />;
}

export function AlignCenterIcon() {
  return <AlignIcon lines={["M3 4h10", "M5 8h6", "M3 12h10"]} />;
}

export function AlignRightIcon() {
  return <AlignIcon lines={["M3 4h10", "M7 8h6", "M3 12h10"]} />;
}

export function AlignJustifyIcon() {
  return <AlignIcon lines={["M3 4h10", "M3 8h10", "M3 12h10"]} />;
}

/** Tableau : grille à en-tête. */
export function TableIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2.5" y="3" width="11" height="10" rx="1" />
      <path d="M2.5 6.5h11M6.5 6.5V13" />
    </svg>
  );
}

/** Image : cadre avec montagne. */
export function ImageIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2.5" y="3" width="11" height="10" rx="1" />
      <path d="m4.5 10.5 2.5-2.5 2 2 1.5-1.5 1 1" />
      <circle cx="6" cy="6" r="0.9" />
    </svg>
  );
}

/** Lien : maillon de chaîne. */
export function LinkIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6.5 9.5 9.5 6.5" />
      <path d="M7.5 4.5 9 3a2.5 2.5 0 0 1 3.5 3.5L11 8" />
      <path d="M8.5 11.5 7 13a2.5 2.5 0 0 1-3.5-3.5L5 8" />
    </svg>
  );
}

/** Saut de page : trait interrompu par deux chevrons. */
export function PageBreakIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2.5 5.5V3h11v2.5M2.5 10.5V13h11v-2.5" />
      <path d="m6 8 2 2 2-2" />
    </svg>
  );
}
