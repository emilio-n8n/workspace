import { createFileRoute, Link, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { authClient } from "@workspace/auth/client";
import { Badge, Button } from "@workspace/ui";
import { type ReactNode, useEffect, useState } from "react";
import {
  IconCalendar,
  IconClose,
  IconFileText,
  IconFolder,
  IconGrid,
  IconHome,
  IconKey,
  IconLogout,
  IconMail,
  IconMenu,
  IconMoon,
  IconPresentation,
  IconSearch,
  IconSun,
  IconVideo,
} from "../components/icons";
import type { Theme } from "../lib/theme";
import { currentTheme, toggleTheme } from "../lib/theme";
import { getSessionFn, getWorkspaceFn, type WorkspaceInfo } from "../server/session";

export const Route = createFileRoute("/app")({
  component: AppLayout,
  beforeLoad: async () => {
    const session = await getSessionFn();
    if (!session) throw redirect({ to: "/login" });
  },
});

type NavItem = {
  label: string;
  to: string;
  status: "active" | "soon";
  phase?: string;
  icon: ReactNode;
};

const navItems: NavItem[] = [
  { label: "Accueil", to: "/app", status: "active", icon: <IconHome /> },
  { label: "Drive", to: "/app", status: "soon", phase: "Phase 2", icon: <IconFolder /> },
  { label: "Docs", to: "/app", status: "soon", phase: "Phase 2", icon: <IconFileText /> },
  { label: "Sheets", to: "/app", status: "soon", phase: "Phase 3", icon: <IconGrid /> },
  { label: "Slides", to: "/app", status: "soon", phase: "Phase 3", icon: <IconPresentation /> },
  { label: "Calendar", to: "/app", status: "soon", phase: "Phase 3", icon: <IconCalendar /> },
  { label: "Tasks", to: "/app", status: "soon", phase: "Phase 3", icon: <IconGrid /> },
  { label: "Forms", to: "/app", status: "soon", phase: "Phase 3", icon: <IconFileText /> },
  { label: "Mail", to: "/app", status: "soon", phase: "Phase 4", icon: <IconMail /> },
  { label: "Meet", to: "/app", status: "soon", phase: "Phase 4", icon: <IconVideo /> },
  { label: "Agents & jetons", to: "/app/settings/tokens", status: "active", icon: <IconKey /> },
];

function AppLayout() {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<WorkspaceInfo>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(currentTheme());
    void (async () => {
      const data = await getWorkspaceFn();
      setWorkspace(data);
      setLoadingWorkspace(false);
    })();
  }, []);

  async function onSignOut() {
    await authClient.signOut();
    await router.navigate({ to: "/" });
    await router.invalidate();
  }

  const initials =
    workspace?.user.name
      ?.split(" ")
      .map((part) => part[0] ?? "")
      .slice(0, 2)
      .join("") ?? "?";

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Colonne latérale — desktop */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
        <div className="flex h-12 items-center gap-2 border-b border-border px-4">
          <span className="flex size-6 items-center justify-center rounded-sm bg-primary text-[10px] font-bold text-primary-foreground">
            W
          </span>
          <span className="font-semibold tracking-tight">Workspace</span>
        </div>

        <SidebarNav />

        <div className="border-t border-border p-3">
          {loadingWorkspace ? (
            <p className="px-1 text-xs text-muted-foreground">Chargement…</p>
          ) : (
            <>
              <p className="px-1 text-xs font-medium text-muted-foreground">Organisation</p>
              <p className="mt-0.5 px-1 text-sm font-medium">
                {workspace?.activeOrganization?.name ?? "—"}
              </p>
              <p className="px-1 text-xs text-muted-foreground">
                {workspace?.organizations.length ?? 0} organisation(s)
              </p>
            </>
          )}
          <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
            <span className="flex size-7 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
              {initials}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              {workspace?.user.email ?? "…"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={onSignOut}
              aria-label="Se déconnecter"
              title="Se déconnecter"
            >
              <IconLogout />
            </Button>
          </div>
        </div>
      </aside>

      {/* Colonne latérale — mobile */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-20 md:hidden">
          <button
            type="button"
            aria-label="Fermer le menu"
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative flex h-full w-64 flex-col border-r border-border bg-card">
            <div className="flex h-12 items-center justify-between border-b border-border px-4">
              <span className="font-semibold tracking-tight">Workspace</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMobileOpen(false)}
                aria-label="Fermer"
              >
                <IconClose />
              </Button>
            </div>
            <SidebarNav />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-border bg-card/85 px-3 backdrop-blur">
          <Button
            variant="ghost"
            size="sm"
            className="md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Ouvrir le menu"
          >
            <IconMenu />
          </Button>

          <div className="relative hidden max-w-md flex-1 sm:block">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground">
              <IconSearch />
            </span>
            <input
              className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground"
              placeholder="Recherche globale — bientôt"
              disabled
              title="La recherche globale sera disponible en Phase 3."
            />
          </div>

          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const next = toggleTheme();
                setTheme(next);
              }}
              aria-label={theme === "dark" ? "Passer en thème clair" : "Passer en thème sombre"}
              title={theme === "dark" ? "Thème clair" : "Thème sombre"}
            >
              {theme === "dark" ? <IconSun /> : <IconMoon />}
            </Button>
            <span className="ml-2 hidden truncate text-sm text-muted-foreground sm:block">
              {workspace?.user.name ?? ""}
            </span>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function SidebarNav() {
  const router = useRouter();
  const currentPath = router.state.location.pathname;

  return (
    <nav className="flex-1 overflow-y-auto p-2" aria-label="Navigation principale">
      <ul className="flex flex-col gap-0.5">
        {navItems.map((item) => {
          const isCurrent = item.status === "active" && currentPath === item.to;
          const disabled = item.status !== "active";
          return (
            <li key={item.label}>
              {disabled ? (
                <span className="flex h-8 cursor-not-allowed items-center gap-2 rounded-md px-2 text-sm text-muted-foreground/70">
                  {item.icon}
                  {item.label}
                  <Badge variant="outline" className="ml-auto text-[10px]">
                    {item.phase}
                  </Badge>
                </span>
              ) : (
                <Link
                  to={item.to}
                  className={`flex h-8 items-center gap-2 rounded-md px-2 text-sm font-medium transition-colors ${
                    isCurrent ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                  }`}
                >
                  {item.icon}
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
