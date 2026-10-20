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

/** Icône générique au trait (16 px) à partir d'un tracé SVG. */
function StrokeIcon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

/** Annuler : flèche courbe vers la gauche. */
export function UndoIcon() {
  return <StrokeIcon d="M5.5 4 2.5 7l3 3M2.5 7h7a4 4 0 0 1 0 8H8" />;
}

/** Rétablir : flèche courbe vers la droite. */
export function RedoIcon() {
  return <StrokeIcon d="M10.5 4l3 3-3 3M13.5 7h-7a4 4 0 0 0 0 8H8" />;
}

/** Liste à puces. */
export function BulletListIcon() {
  return <StrokeIcon d="M6 4h8M6 8h8M6 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" />;
}

/** Liste numérotée. */
export function OrderedListIcon() {
  return (
    <StrokeIcon d="M6.5 4h7.5M6.5 8h7.5M6.5 12h7.5M2 3l1-.5V6M2 6h2M2 9.5c.4-.6 2-.6 2 .4 0 .8-2 1.2-2 2.1h2" />
  );
}

/** Liste de tâches (cases à cocher). */
export function TaskListIcon() {
  return <StrokeIcon d="M2 3h3v3H2zM2 10h3v3H2zM2.6 11.6l.8.8 1.4-1.6M7.5 4.5H14M7.5 11.5H14" />;
}

/** Diminuer le retrait. */
export function OutdentIcon() {
  return <StrokeIcon d="M2 3h12M7 6.5h7M7 9.5h7M2 13h12M4.5 6 2.5 8l2 2" />;
}

/** Augmenter le retrait. */
export function IndentIcon() {
  return <StrokeIcon d="M2 3h12M7 6.5h7M7 9.5h7M2 13h12M2.5 6l2 2-2 2" />;
}

/** Effacer la mise en forme : T barré. */
export function ClearFormatIcon() {
  return <StrokeIcon d="M3 3.5h8M7 3.5 5 12.5M9.5 9.5l4 4M13.5 9.5l-4 4" />;
}

/** Interligne : flèches verticales et lignes. */
export function LineHeightIcon() {
  return <StrokeIcon d="M7 4h7M7 8h7M7 12h7M3 2.5v11M1.5 4 3 2.5 4.5 4M1.5 12 3 13.5 4.5 12" />;
}

/** Commentaire : bulle. */
export function CommentIcon() {
  return <StrokeIcon d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />;
}

/** Couleur du texte : « A » souligné. */
export function TextColorIcon() {
  return <StrokeIcon d="M4.5 11 8 2.5 11.5 11M5.7 8h4.6M2.5 14h11" />;
}

/** Surlignage : surligneur. */
export function HighlightIcon() {
  return <StrokeIcon d="m9.5 2.5 4 4-6 6H3.5v-4zM2 14h12" />;
}
