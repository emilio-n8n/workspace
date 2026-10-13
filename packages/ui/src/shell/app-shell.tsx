import { type ReactNode, useEffect, useRef, useState } from "react";
import { AppRail } from "./app-rail.tsx";
import {
  CommandPalette,
  type PaletteAction,
  type PaletteSearchResult,
} from "./command-palette.tsx";
import type { ResolvedSuiteApp, SuiteAppId } from "./suite-apps.ts";
import { type NotificationBellItem, TopBar } from "./top-bar.tsx";

/** Flux SSE des notifications (même origine dans chaque application). */
const NOTIFICATIONS_STREAM_URL = "/api/notifications/stream";
/** Cadence du repli : mêmes ~60 s que le polling historique des applications. */
const NOTIFICATIONS_POLL_MS = 60_000;

/**
 * Données de la cloche de notifications gérées par l'application :
 * état affiché, navigation et actions (rechargement compris).
 */
export type NotificationBellData = {
  unreadCount: number;
  items: NotificationBellItem[];
  onOpenItem: (notification: NotificationBellItem) => void;
  onMarkAllRead: () => void;
  /** Recharge les notifications (déclenché à l'ouverture du panneau). */
  onRefresh: () => void;
};

export type AppShellProps = {
  activeAppId: SuiteAppId;
  apps: ResolvedSuiteApp[];
  homeHref: string;
  tokensHref: string;
  user: { name: string; email: string };
  organizations: { id: string; name: string }[];
  activeOrgId: string | null;
  onSwitchOrg: (organizationId: string) => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onSignOut: () => void;
  /** Contenu additionnel dans la barre supérieure (ex. fil d'Ariane). */
  topBarContent?: ReactNode;
  headerActions?: PaletteAction[];
  /** Recherche globale optionnelle (résultats injectés dans la palette). */
  search?: (query: string) => Promise<PaletteSearchResult[]>;
  /** Cloche de notifications optionnelle (absente = pas de cloche). */
  notifications?: NotificationBellData;
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
  organizations,
  activeOrgId,
  onSwitchOrg,
  theme,
  onToggleTheme,
  onSignOut,
  topBarContent,
  headerActions = [],
  search,
  notifications,
  children,
}: AppShellProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteResults, setPaletteResults] = useState<PaletteSearchResult[]>([]);
  const [paletteSearching, setPaletteSearching] = useState(false);
  const searchRequestId = useRef(0);
  const activeApp = apps.find((app) => app.id === activeAppId) ?? apps[0];

  // Recherche globale débouncée (250 ms) : les requêtes de moins de 2 caractères
  // ne partent pas, les réponses obsolètes sont ignorées et les erreurs restent
  // muettes — la recherche ne doit jamais casser la palette.
  useEffect(() => {
    const query = paletteQuery.trim();
    const requestId = ++searchRequestId.current;
    if (!search || query.length < 2) {
      setPaletteResults([]);
      setPaletteSearching(false);
      return;
    }
    setPaletteSearching(true);
    const timer = window.setTimeout(() => {
      search(query)
        .then((found) => {
          if (searchRequestId.current !== requestId) return;
          setPaletteResults(found);
          setPaletteSearching(false);
        })
        .catch(() => {
          if (searchRequestId.current !== requestId) return;
          setPaletteSearching(false);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [paletteQuery, search]);

  // Cloche en temps réel : quand c'est possible un flux SSE rafraîchit les
  // notifications ; s'il échoue (ou que le navigateur ne le propose pas), on
  // retombe sur le polling périodique — jamais les deux à la fois. L'onglet
  // redevenu visible retente l'ouverture du flux.
  const notificationsRefresh = notifications?.onRefresh;
  useEffect(() => {
    if (!notificationsRefresh) return;
    const canStream = typeof window !== "undefined" && "EventSource" in window;
    let source: EventSource | null = null;
    let pollTimer: number | null = null;

    const stopPolling = () => {
      if (pollTimer === null) return;
      window.clearInterval(pollTimer);
      pollTimer = null;
    };
    const startPolling = () => {
      if (pollTimer !== null) return;
      pollTimer = window.setInterval(() => void notificationsRefresh(), NOTIFICATIONS_POLL_MS);
    };
    const closeStream = () => {
      source?.close();
      source = null;
    };
    const openStream = () => {
      if (!canStream || source) return;
      stopPolling();
      const next = new EventSource(NOTIFICATIONS_STREAM_URL);
      source = next;
      // L'évènement ne porte qu'un signal : la liste est rechargée via la
      // server fn existante.
      next.onmessage = () => void notificationsRefresh();
      next.onerror = () => {
        if (source !== next) return;
        closeStream();
        startPolling();
      };
    };

    if (canStream) openStream();
    else startPolling();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") openStream();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      closeStream();
      stopPolling();
    };
  }, [notificationsRefresh]);

  const paletteActions: PaletteAction[] = [
    {
      id: "action-search",
      label: "Rechercher dans toute la suite…",
      group: "Actions",
      onSelect: () => {
        window.location.assign(`${homeHref}/recherche`);
      },
    },
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
    <div className="flex h-dvh bg-background text-foreground">
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow-lift"
      >
        Aller au contenu
      </a>
      <AppRail
        apps={apps}
        activeAppId={activeAppId}
        homeHref={homeHref}
        onOpenPalette={() => setPaletteOpen(true)}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar
          activeApp={activeApp}
          apps={apps}
          homeHref={homeHref}
          tokensHref={tokensHref}
          user={user}
          organizations={organizations}
          activeOrgId={activeOrgId}
          onSwitchOrg={onSwitchOrg}
          theme={theme}
          onToggleTheme={onToggleTheme}
          onSignOut={onSignOut}
          onOpenPalette={() => setPaletteOpen(true)}
          notifications={
            notifications
              ? {
                  unreadCount: notifications.unreadCount,
                  items: notifications.items,
                  onOpenItem: notifications.onOpenItem,
                  onMarkAllRead: notifications.onMarkAllRead,
                  // L'ouverture du panneau recharge les notifications.
                  onOpenChange: (open) => {
                    if (open) notifications.onRefresh();
                  },
                }
              : undefined
          }
        >
          {topBarContent}
        </TopBar>

        <main id="contenu" className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        actions={paletteActions}
        results={paletteResults}
        searching={paletteSearching}
        onQueryChange={search ? setPaletteQuery : undefined}
      />
    </div>
  );
}
