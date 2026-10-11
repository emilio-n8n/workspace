import { useState, type ReactNode } from "react";
import { AppRail } from "./app-rail.tsx";
import { CommandPalette, type PaletteAction } from "./command-palette.tsx";
import { TopBar } from "./top-bar.tsx";
import type { ResolvedSuiteApp, SuiteAppId } from "./suite-apps.ts";

export type AppShellProps = {
  activeAppId: SuiteAppId;
  apps: ResolvedSuiteApp[];
  homeHref: string;
  tokensHref: string;
  user: { name: string; email: string };
  orgName: string | null;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onSignOut: () => void;
  /** Contenu additionnel dans la barre supérieure (ex. fil d'Ariane). */
  topBarContent?: ReactNode;
  headerActions?: PaletteAction[];
  children: ReactNode;
};

/**
 * Coque commune de toutes les applications de la suite :
 * rail d'apps (76 px) + barre supérieure + palette ⌘K + zone de contenu.
 */
export function AppShell({
  activeAppId,
  apps,
  homeHref,
  tokensHref,
  user,
  orgName,
  theme,
  onToggleTheme,
  onSignOut,
  topBarContent,
  headerActions = [],
  children,
}: AppShellProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const activeApp = apps.find((app) => app.id === activeAppId) ?? apps[0];

  const paletteActions: PaletteAction[] = [
    ...apps
      .filter((app) => app.shipped && app.href)
      .map((app) => ({
        id: `app-${app.id}`,
        label: `Aller à ${app.name} — ${app.description}`,
        group: "Applications",
        onSelect: () => {
          window.location.assign(app.href ?? homeHref);
        },
      })),
    {
      id: "action-theme",
      label: theme === "dark" ? "Passer en thème clair" : "Passer en thème sombre",
      group: "Actions",
      onSelect: onToggleTheme,
    },
    {
      id: "action-tokens",
      label: "Ouvrir « Agents & jetons »",
      group: "Actions",
      onSelect: () => window.location.assign(tokensHref),
    },
    ...headerActions,
  ];

  if (!activeApp) {
    throw new Error("AppShell exige au moins une application dans le registre.");
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <AppRail
        apps={apps}
        activeAppId={activeAppId}
        homeHref={homeHref}
        onOpenPalette={() => setPaletteOpen(true)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          activeApp={activeApp}
          apps={apps}
          homeHref={homeHref}
          tokensHref={tokensHref}
          user={user}
          orgName={orgName}
          theme={theme}
          onToggleTheme={onToggleTheme}
          onSignOut={onSignOut}
          onOpenPalette={() => setPaletteOpen(true)}
        >
          {topBarContent}
        </TopBar>

        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        actions={paletteActions}
      />
    </div>
  );
}
