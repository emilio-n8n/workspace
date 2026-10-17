import { createFileRoute, Outlet, redirect, useRouter } from "@tanstack/react-router";
import type { NotificationView } from "@workspace/notifications";
import {
  AppShell,
  currentTheme,
  isAppAvailable,
  resolveSuiteApps,
  type SuiteAppId,
  type Theme,
  toggleTheme,
} from "@workspace/ui";
import { useCallback, useEffect, useState } from "react";
import {
  getAppUrlsFn,
  getSessionFn,
  getWorkspaceFn,
  listNotificationsFn,
  markAllNotificationsReadFn,
  markNotificationReadFn,
  searchFn,
  signOutFn,
  switchOrgFn,
  type WorkspaceInfo,
} from "../server/context.ts";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
  beforeLoad: async () => {
    const session = await getSessionFn();
    if (!session) {
      const urls = await getAppUrlsFn();
      throw redirect({ href: `${urls.home}/login` });
    }
  },
});

type AppUrls = {
  home: string;
  drive: string;
  docs: string;
  sheets: string;
  slides: string;
  calendar: string;
  tasks: string;
  forms: string;
  mail: string;
  chat: string;
  meet: string;
  sites: string;
  classroom: string;
  admin: string;
};

type NotificationData = {
  unreadCount: number;
  items: NotificationView[];
};

function AppLayout() {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<WorkspaceInfo>(null);
  const [urls, setUrls] = useState<AppUrls | null>(null);
  const [theme, setTheme] = useState<Theme>("light");
  const [loadError, setLoadError] = useState(false);
  const [notifications, setNotifications] = useState<NotificationData>({
    unreadCount: 0,
    items: [],
  });

  const refreshNotifications = useCallback(async () => {
    try {
      setNotifications(await listNotificationsFn());
    } catch {
      // Silencieux : la cloche ne doit jamais casser la mise en page.
    }
  }, []);

  // Recharge les notifications au montage ; le rafraîchissement périodique
  // est assuré par l'AppShell (SSE temps réel + repli polling).
  useEffect(() => {
    void refreshNotifications();
  }, [refreshNotifications]);

  useEffect(() => {
    setTheme(currentTheme());
    void (async () => {
      try {
        const [data, appUrls] = await Promise.all([getWorkspaceFn(), getAppUrlsFn()]);
        setWorkspace(data);
        setUrls(appUrls);
      } catch {
        setLoadError(true);
      }
    })();
  }, []);

  async function onSignOut() {
    await signOutFn();
    const home = urls?.home ?? "/";
    await router.invalidate();
    window.location.assign(`${home}/`);
  }

  if (loadError) {
    return (
      <div className="grid min-h-screen place-items-center p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-destructive">Impossible de charger votre espace de travail.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted"
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  if (!workspace || !urls) {
    return <p className="p-8 text-sm text-muted-foreground">Chargement…</p>;
  }

  // Application hors du type d'espace actif (ex. espace personnel) : on
  // l'explique au lieu d'ouvrir un écran que le rail ne propose pas.
  const unavailable = !isAppAvailable("sites", workspace.activeOrganization?.kind);

  return (
    <AppShell
      activeAppId={"sites" as SuiteAppId}
      apps={resolveSuiteApps(urls, workspace.activeOrganization?.kind)}
      search={async (query) => await searchFn({ data: { query } })}
      notifications={{
        unreadCount: notifications.unreadCount,
        items: notifications.items,
        onOpenItem: (n) => {
          void markNotificationReadFn({ data: { id: n.id } })
            .then(() => refreshNotifications())
            .catch(() => undefined);
          if (n.href) window.location.assign(n.href);
        },
        onMarkAllRead: () => {
          void markAllNotificationsReadFn()
            .then(() => refreshNotifications())
            .catch(() => undefined);
        },
        onRefresh: () => void refreshNotifications(),
      }}
      homeHref={`${urls.home}/app`}
      tokensHref={`${urls.home}/app/settings/tokens`}
      user={{ name: workspace.user.name, email: workspace.user.email }}
      organizations={workspace.organizations}
      activeOrgId={workspace.activeOrganization?.id ?? null}
      onSwitchOrg={(orgId) => {
        void (async () => {
          await switchOrgFn({ data: { organizationId: orgId } });
          window.location.reload();
        })();
      }}
      theme={theme}
      onToggleTheme={() => setTheme(toggleTheme())}
      onSignOut={() => void onSignOut()}
    >
      {unavailable ? (
        <div className="grid flex-1 place-items-center p-8">
          <div className="flex max-w-md flex-col items-center gap-3 text-center">
            <h1 className="font-display text-xl">Application indisponible dans cet espace</h1>
            <p className="text-sm text-muted-foreground">
              Sites est réservé aux espaces entreprise et éducation. Changez d'espace avec le
              sélecteur d'organisation ou revenez à l'accueil.
            </p>
            <a
              href={`${urls.home}/app`}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted"
            >
              Retour à l'accueil
            </a>
          </div>
        </div>
      ) : (
        <Outlet />
      )}
    </AppShell>
  );
}
