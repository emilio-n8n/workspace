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
