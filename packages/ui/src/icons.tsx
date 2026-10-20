import type { SVGProps } from "react";

/** Icônes stroke 16px — géométrie simple, cohérente, aucune police d'icônes. */
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

export function IconHome(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M2.5 7.5 8 3l5.5 4.5" />
      <path d="M4 6.5V13h8V6.5" />
    </Svg>
  );
}

export function IconFolder(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 7v5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12z" />
    </Svg>
  );
}

export function IconFileText(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M4 1.5h5.5L12 4v10.5H4z" />
      <path d="M6 7h4M6 9.5h4" />
    </Svg>
  );
}

export function IconGrid(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
      <path d="M6 2v12M10 2v12M2 6h12M2 10h12" />
    </Svg>
  );
}

export function IconPresentation(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="2" y="2.5" width="12" height="8" rx="1" />
      <path d="M8 10.5V13M5.5 13h5" />
    </Svg>
  );
}

export function IconCalendar(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="2" y="3.5" width="12" height="10.5" rx="1.5" />
      <path d="M2 7h12M5.5 2v3M10.5 2v3" />
    </Svg>
  );
}

export function IconMail(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
      <path d="m2.5 4.5 5.5 4 5.5-4" />
    </Svg>
  );
}

export function IconVideo(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="2" y="4" width="8" height="8" rx="1.5" />
      <path d="m10 8 4-2.5v5L10 8z" />
    </Svg>
  );
}

export function IconSearch(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="7" cy="7" r="4" />
      <path d="m10 10 3.5 3.5" />
    </Svg>
  );
}

export function IconSun(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
    </Svg>
  );
}

export function IconMoon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M13 9.8A5.6 5.6 0 0 1 6.2 3 5.5 5.5 0 1 0 13 9.8z" />
    </Svg>
  );
}

export function IconLogout(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M6 2H3.5A1.5 1.5 0 0 0 2 3.5v9A1.5 1.5 0 0 0 3.5 14H6" />
      <path d="M9.5 5.5 12 8l-2.5 2.5M12 8H6" />
    </Svg>
  );
}

export function IconMenu(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M2 4h12M2 8h12M2 12h12" />
    </Svg>
  );
}

export function IconClose(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
    </Svg>
  );
}

export function IconChevronDown(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="m4 6.5 4 4 4-4" />
    </Svg>
  );
}

export function IconApps(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      {[3, 8, 13].map((x) =>
        [3, 8, 13].map((y) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" fill="currentColor" stroke="none" />
        )),
      )}
    </Svg>
  );
}

export function IconKey(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="5" cy="8" r="2.6" />
      <path d="m7 8h7M11.5 8v2M13.2 8v1.5" />
    </Svg>
  );
}

export function IconCopy(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.2" />
      <path d="M3 10.5V3.7A1.2 1.2 0 0 1 4.2 2.5H11" />
    </Svg>
  );
}

export function IconTrash(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M3 4.5h10M6.5 4.5v-2h3v2M4.5 4.5l.6 9h5.8l.6-9" />
      <path d="M6.8 7v4M9.2 7v4" />
    </Svg>
  );
}

export function IconImage(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <circle cx="5.8" cy="6.5" r="1.1" />
      <path d="m3.5 12 3.2-3.2 2.3 2.3 2-2L14 11.5" />
    </Svg>
  );
}

export function IconArchive(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="2" y="2.5" width="12" height="3.5" rx="1" />
      <path d="M3 6v6.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6" />
      <path d="M6.8 8.5h2.4" />
    </Svg>
  );
}

export function IconMusic(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M6 12.5V4.5l6-1.5v8" />
      <circle cx="4.5" cy="12.5" r="1.6" />
      <circle cx="10.5" cy="11" r="1.6" />
    </Svg>
  );
}

export function IconCheckSquare(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="m5 8 2.2 2.2L11.5 5.5" />
    </Svg>
  );
}

export function IconClipboard(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="3" width="9" height="11" rx="1.5" />
      <path d="M6 3V2.2A.7.7 0 0 1 6.7 1.5h2.6a.7.7 0 0 1 .7.7V3" />
      <path d="M6.2 6.5h3.6M6.2 9h2.6" />
    </Svg>
  );
}

export function IconGlobe(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="6" />
      <path d="M2.5 6h11M2.5 10h11M8 2c-2 2-2 10 0 12M8 2c2 2 2 10 0 12" />
    </Svg>
  );
}

export function IconChat(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M2.5 3.5h11v7.5h-6.5L4 13.5V11H2.5z" />
    </Svg>
  );
}

export function IconGraduation(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="m8 2 6.5 3L8 8 1.5 5z" />
      <path d="M4 6.5V10c0 1.2 8 1.2 8 0V6.5" />
    </Svg>
  );
}

export function IconSettings(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </Svg>
  );
}

export function IconBell(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M8 2a3.5 3.5 0 0 1 3.5 3.5c0 3 1.5 4 1.5 4h-10s1.5-1 1.5-4A3.5 3.5 0 0 1 8 2z" />
      <path d="M6.5 12.5a1.5 1.5 0 0 0 3 0" />
    </Svg>
  );
}

export function IconPlus(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M8 3v10M3 8h10" />
    </Svg>
  );
}

export function IconMinus(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M3 8h10" />
    </Svg>
  );
}

export function IconUndo(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M5.5 3 2.5 6l3 3" />
      <path d="M2.5 6h7a4 4 0 0 1 0 8H7" />
    </Svg>
  );
}

export function IconRedo(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="m10.5 3 3 3-3 3" />
      <path d="M13.5 6h-7a4 4 0 0 0 0 8H9" />
    </Svg>
  );
}

/** Rotation horaire (pivoter de 90°). */
export function IconRotate(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M13 3v3.5H9.5" />
      <path d="M12.6 6.5A5 5 0 1 0 13 9" />
    </Svg>
  );
}

/** Trieuse : grille de vignettes. */
export function IconLayoutGrid(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="2" y="2.5" width="5" height="4.5" rx="0.8" />
      <rect x="9" y="2.5" width="5" height="4.5" rx="0.8" />
      <rect x="2" y="9" width="5" height="4.5" rx="0.8" />
      <rect x="9" y="9" width="5" height="4.5" rx="0.8" />
    </Svg>
  );
}

/** Vue normale : une diapositive et sa colonne de vignettes. */
export function IconSlideNormal(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="1.5" y="3" width="3" height="10" rx="0.6" />
      <rect x="6" y="3" width="8.5" height="10" rx="1" />
    </Svg>
  );
}

export function IconArrowUp(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M8 13V3M4 7l4-4 4 4" />
    </Svg>
  );
}

export function IconArrowDown(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M8 3v10M4 9l4 4 4-4" />
    </Svg>
  );
}

/** Plein écran / mode concentration. */
export function IconExpand(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
    </Svg>
  );
}
