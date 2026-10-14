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
