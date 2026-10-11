import { cn } from "../cn.ts";
import { BrandMark } from "./brand-mark.tsx";
import type { ResolvedSuiteApp, SuiteAppId } from "./suite-apps.ts";

export type AppRailProps = {
  apps: ResolvedSuiteApp[];
  activeAppId: SuiteAppId;
  homeHref: string;
  onOpenPalette: () => void;
};

/** Rail d'applications (76 px) : lanceur vertical persistant de toute la suite. */
export function AppRail({ apps, activeAppId, homeHref, onOpenPalette }: AppRailProps) {
  const live = apps.filter((app) => app.shipped && app.href);

  return (
    <nav
      aria-label="Applications de la suite"
      className="hidden w-[76px] shrink-0 flex-col items-center gap-1.5 overflow-y-auto bg-rail py-4 text-rail-foreground md:flex"
    >
      <a
        href={homeHref}
        aria-label="Accueil Workspace"
        className="mb-3 shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-rail"
      >
        <BrandMark />
      </a>

      {live.map((app) => {
        const active = app.id === activeAppId;
        return (
          <a
            key={app.id}
            href={app.href}
            aria-label={app.name}
            title={app.name}
            aria-current={active ? "page" : undefined}
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-rail",
              active
                ? "bg-rail-active text-rail-active-foreground shadow-soft"
                : "text-rail-foreground/80 hover:bg-rail-active/50 hover:text-rail-active-foreground",
            )}
          >
            <app.Icon className="size-5" />
          </a>
        );
      })}

      <button
        type="button"
        onClick={onOpenPalette}
        aria-label="Ouvrir la palette de commandes (Ctrl+K)"
        title="Palette de commandes (Ctrl+K)"
        className="mt-auto grid size-11 shrink-0 place-items-center rounded-xl border border-rail-active text-sm font-semibold text-rail-foreground/80 transition-colors hover:bg-rail-active/50 hover:text-rail-active-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-rail"
      >
        ⌘K
      </button>
    </nav>
  );
}
