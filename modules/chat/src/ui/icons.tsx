import type { SVGProps } from "react";

/**
 * Icônes propres au module Chat — mêmes règles que @workspace/ui : géométrie
 * 16 px, tracé 1,6, couleur héritée (`currentColor`), jamais de police d'icônes.
 */

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Svg({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0" aria-hidden {...base} {...props}>
      {children}
    </svg>
  );
}

/** Épingle de message. */
export function IconPin(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M8 1.8a2.4 2.4 0 0 1 2.4 2.4c0 1.7-1.1 2.6-1.7 3.4-.3.4-.3.8-.3 1.2H7.6c0-.4 0-.8-.3-1.2C6.7 6.8 5.6 5.9 5.6 4.2A2.4 2.4 0 0 1 8 1.8z" />
      <path d="M6.9 10.6h2.2M7.3 12.4h1.4M7.6 14.2h.8" />
    </Svg>
  );
}

/** Cadenas des canaux privés. */
export function IconLock(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="3.2" y="7" width="9.6" height="6.8" rx="1.6" />
      <path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7" />
      <path d="M8 9.8v1.8" />
    </Svg>
  );
}

/** Membres du canal. */
export function IconUsers(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="6" cy="5.4" r="2.2" />
      <path d="M2.2 13.4c0-2.1 1.7-3.4 3.8-3.4s3.8 1.3 3.8 3.4" />
      <path d="M10.6 3.6a2.1 2.1 0 0 1 0 3.9M11.8 10.3c1.3.5 2 1.6 2 3.1" />
    </Svg>
  );
}

/** Menu « ⋯ » des actions secondaires. */
export function IconMore(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      {[3, 8, 13].map((cx) => (
        <circle key={cx} cx={cx} cy={8} r="1.2" fill="currentColor" stroke="none" />
      ))}
    </Svg>
  );
}

/** Crayon de l'édition en place d'un message. */
export function IconPen(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="m3 13 .6-2.8L10.9 2.9a1.5 1.5 0 0 1 2.2 2.2L5.8 12.4z" />
      <path d="m9.8 4 2.2 2.2" />
    </Svg>
  );
}

/** Trombonne des pièces jointes du compositeur. */
export function IconPaperclip(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M13.4 7.2 8.1 12.5a3.1 3.1 0 0 1-4.4-4.4l5.6-5.6a2 2 0 0 1 2.9 2.9L6.7 10.9a.9.9 0 0 1-1.3-1.3l4.9-4.9" />
    </Svg>
  );
}
