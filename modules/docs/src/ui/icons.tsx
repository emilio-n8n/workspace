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
