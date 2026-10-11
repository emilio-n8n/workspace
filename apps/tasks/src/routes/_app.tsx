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

type AppUrls = { home: string; drive: string; docs: string; tasks: string };

function AppLayout() {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<WorkspaceInfo>(null);
  const [urls, setUrls] = useState<AppUrls | null>(null);
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(currentTheme());
    void (async () => {
      const [data, appUrls] = await Promise.all([getWorkspaceFn(), getAppUrlsFn()]);
      setWorkspace(data);
      setUrls(appUrls);
    })();
  }, []);

  async function onSignOut() {
    await signOutFn();
    const home = urls?.home ?? "/";
    await router.invalidate();
    window.location.assign(`${home}/`);
  }

  if (!workspace || !urls) {
    return <p className="p-8 text-sm text-muted-foreground">Chargement…</p>;
  }

  return (
    <AppShell
      activeAppId={"tasks" as SuiteAppId}
      apps={resolveSuiteApps(urls)}
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
