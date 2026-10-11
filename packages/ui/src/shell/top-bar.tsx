import { useState } from "react";
import { cn } from "../cn.ts";
import { Badge } from "../components/badge.tsx";
import { Button } from "../components/button.tsx";
import {
  IconApps,
  IconChevronDown,
  IconKey,
  IconLogout,
  IconMoon,
  IconSearch,
  IconSun,
} from "../icons.tsx";
import { BrandMark } from "./brand-mark.tsx";
import type { ResolvedSuiteApp } from "./suite-apps.ts";

export type TopBarProps = {
  activeApp: ResolvedSuiteApp;
  apps: ResolvedSuiteApp[];
  homeHref: string;
  tokensHref: string;
  user: { name: string; email: string };
  orgName: string | null;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onSignOut: () => void;
  onOpenPalette: () => void;
  children?: React.ReactNode;
};

/** Barre supérieure partagée : recherche/palette, lanceur d'apps, thème, compte. */
export function TopBar({
  activeApp,
  apps,
  homeHref,
  tokensHref,
  user,
  orgName,
  theme,
  onToggleTheme,
  onSignOut,
  onOpenPalette,
  children,
}: TopBarProps) {
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="relative flex h-14 items-center gap-2 border-b border-border bg-surface px-3 md:px-4">
      <div className="flex items-center gap-2 md:hidden">
        <BrandMark className="size-7 rounded-md text-sm" />
        <span className="font-display text-sm font-semibold">{activeApp.name}</span>
      </div>

      <span
        aria-hidden
        className={cn("hidden items-center gap-2 pl-1 md:flex", activeApp.toneClass)}
      >
        <activeApp.Icon className="size-4" />
      </span>
      <span className="hidden font-display text-sm font-semibold tracking-tight md:block">
        {activeApp.name}
      </span>

      <div className="hidden min-w-0 flex-1 items-center gap-3 pl-4 sm:flex">{children}</div>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={onOpenPalette}
          className="mr-1 hidden h-9 w-64 items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground shadow-soft transition-colors hover:bg-muted lg:flex"
        >
          <IconSearch />
          <span className="truncate">Rechercher ou agir…</span>
          <kbd className="ml-auto rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[10px] font-medium">
            ⌘K
          </kbd>
        </button>

        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            aria-haspopup="menu"
            aria-expanded={launcherOpen}
            aria-label="Ouvrir le lanceur d'applications"
            onClick={() => setLauncherOpen((current) => !current)}
          >
            <IconApps />
          </Button>
          {launcherOpen ? (
            <>
              <button
                type="button"
                aria-label="Fermer le lanceur"
                className="fixed inset-0 z-30 cursor-default"
                onClick={() => setLauncherOpen(false)}
              />
              <div
                role="menu"
                className="absolute right-0 z-40 mt-1 w-80 rounded-xl border border-border bg-popover p-2 shadow-lift"
              >
                <p className="px-2 pb-1 pt-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Applications
                </p>
                <div className="grid grid-cols-3 gap-1">
                  {apps.map((app) =>
                    app.shipped && app.href ? (
                      <a
                        key={app.id}
                        href={app.href}
                        className="flex flex-col items-center gap-1.5 rounded-lg px-2 py-3 text-center transition-colors hover:bg-muted"
                      >
                        <app.Icon className={cn("size-5", app.toneClass)} />
                        <span className="text-xs font-medium">{app.name}</span>
                      </a>
                    ) : (
                      <span
                        key={app.id}
                        className="flex cursor-not-allowed flex-col items-center gap-1.5 rounded-lg px-2 py-3 text-center opacity-55"
                        title="Prévu — pas encore disponible"
                      >
                        <app.Icon className={cn("size-5", app.toneClass)} />
                        <span className="text-xs font-medium">{app.name}</span>
                        <Badge variant="outline" className="text-[9px]">
                          Phase {app.phase}
                        </Badge>
                      </span>
                    ),
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "Passer en thème clair" : "Passer en thème sombre"}
          title={theme === "dark" ? "Thème clair" : "Thème sombre"}
        >
          {theme === "dark" ? <IconSun /> : <IconMoon />}
        </Button>

        <div className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Menu du compte"
            onClick={() => setMenuOpen((current) => !current)}
            className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-muted"
          >
            <span className="grid size-7 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <IconChevronDown className="size-3.5 text-muted-foreground" />
          </button>
          {menuOpen ? (
            <>
              <button
                type="button"
                aria-label="Fermer le menu du compte"
                className="fixed inset-0 z-30 cursor-default"
                onClick={() => setMenuOpen(false)}
              />
              <div
                role="menu"
                className="absolute right-0 z-40 mt-1 w-64 rounded-xl border border-border bg-popover p-1 shadow-lift"
              >
                <div className="border-b border-border px-3 py-2">
                  <p className="truncate text-sm font-medium">{user.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                  {orgName ? (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      Organisation : {orgName}
                    </p>
                  ) : null}
                </div>
                <a
                  href={homeHref}
                  role="menuitem"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                  onClick={() => setMenuOpen(false)}
                >
                  Accueil
                </a>
                <a
                  href={tokensHref}
                  role="menuitem"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                  onClick={() => setMenuOpen(false)}
                >
                  <IconKey /> Agents & jetons
                </a>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    setMenuOpen(false);
                    onSignOut();
                  }}
                >
                  <IconLogout /> Se déconnecter
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
