import { createFileRoute, Outlet, redirect, useRouter } from "@tanstack/react-router";
import {
  AppShell,
  currentTheme,
  resolveSuiteApps,
  type SuiteAppId,
  type Theme,
  toggleTheme,
} from "@workspace/ui";
import { useEffect, useState } from "react";
import {
  getAppUrlsFn,
  getSessionFn,
  getWorkspaceFn,
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

function AppLayout() {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<WorkspaceInfo>(null);
  const [urls, setUrls] = useState<AppUrls | null>(null);
  const [theme, setTheme] = useState<Theme>("light");
  const [loadError, setLoadError] = useState(false);

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

  return (
    <AppShell
      activeAppId={"sites" as SuiteAppId}
      apps={resolveSuiteApps(urls)}
      search={async (query) => await searchFn({ data: { query } })}
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
      <Outlet />
    </AppShell>
  );
}
