import type { SVGProps } from "react";
import type { SiteBlockKind } from "../blocks.ts";

/**
 * Icônes des blocs du constructeur de pages.
 * Même langage visuel que `@workspace/ui/icons` (trait 16 px, `currentColor`) :
 * la bibliothèque partagée n'est pas enrichie pour un besoin local à Sites,
 * les cinq glyphes vivent donc ici.
 */
const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Glyph({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0" aria-hidden {...base} {...props}>
      {children}
    </svg>
  );
}

/** Glyphe d'un type de bloc (titre, texte, image, bouton, colonnes). */
export function BlockGlyph({ kind, ...props }: { kind: SiteBlockKind } & SVGProps<SVGSVGElement>) {
  switch (kind) {
    case "heading":
      return (
        <Glyph {...props}>
          <path d="M3 4h10M8 4v8" />
        </Glyph>
      );
    case "text":
      return (
        <Glyph {...props}>
          <path d="M3 4h10M3 8h10M3 12h6" />
        </Glyph>
      );
    case "image":
      return (
        <Glyph {...props}>
          <rect x="2" y="3" width="12" height="10" rx="1.5" />
          <circle cx="5.8" cy="6.5" r="1.1" />
          <path d="m3.5 12 3.2-3.2 2.3 2.3 2-2L14 11.5" />
        </Glyph>
      );
    case "button":
      return (
        <Glyph {...props}>
          <rect x="2" y="4.5" width="12" height="7" rx="3.5" />
          <path d="M6 8h4" />
        </Glyph>
      );
    case "columns":
      return (
        <Glyph {...props}>
          <rect x="2" y="2.5" width="5.5" height="11" rx="1" />
          <rect x="8.5" y="2.5" width="5.5" height="11" rx="1" />
        </Glyph>
      );
  }
}
