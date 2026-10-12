import { useEffect, useState } from "react";
import { cn } from "../cn.ts";
import { Badge } from "../components/badge.tsx";
import { Button } from "../components/button.tsx";
import {
  IconApps,
  IconBell,
  IconCheckSquare,
  IconChevronDown,
  IconKey,
  IconLogout,
  IconMoon,
  IconSearch,
  IconSun,
} from "../icons.tsx";
import { BrandMark } from "./brand-mark.tsx";
import type { ResolvedSuiteApp } from "./suite-apps.ts";

/**
 * Vue minimale d'une notification affichée par la cloche. Volontairement
 * structurelle : le type `NotificationView` de `@workspace/notifications` y est
 * assignable dès qu'il expose ces champs.
 */
export type NotificationBellItem = {
  id: string;
  title: string;
  body?: string | null;
  href?: string | null;
  read?: boolean;
  createdAt?: string | number | Date;
};

/** Données et actions de la cloche de notifications. */
export type TopBarNotifications = {
  unreadCount: number;
  items: NotificationBellItem[];
  onOpenItem: (notification: NotificationBellItem) => void;
  onMarkAllRead: () => void;
  /** Notifié à chaque ouverture/fermeture du panneau. */
  onOpenChange?: (open: boolean) => void;
};

export type TopBarProps = {
  activeApp: ResolvedSuiteApp;
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
  onOpenPalette: () => void;
  /** Cloche de notifications (absente = pas de cloche). */
  notifications?: TopBarNotifications;
  children?: React.ReactNode;
};

/** Horodatage relatif court : « il y a 5 min », « il y a 2 j »… */
function timeAgo(value: NotificationBellItem["createdAt"]): string | null {
  if (value === undefined || value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "à l'instant";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `il y a ${days} j`;
  const months = Math.floor(days / 30);
  if (months < 12) return `il y a ${months} mois`;
  const years = Math.floor(months / 12);
  return `il y a ${years} an${years > 1 ? "s" : ""}`;
}

/** Barre supérieure partagée : recherche/palette, lanceur d'apps, thème, compte. */
export function TopBar({
  activeApp,
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
  onOpenPalette,
  notifications,
  children,
}: TopBarProps) {
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  // Échap ferme les menus (comportement attendu, cohérent avec <dialog>).
  useEffect(() => {
    if (!launcherOpen && !menuOpen && !notificationsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLauncherOpen(false);
        setMenuOpen(false);
        if (notificationsOpen) {
          setNotificationsOpen(false);
          notifications?.onOpenChange?.(false);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [launcherOpen, menuOpen, notificationsOpen, notifications]);

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
                tabIndex={-1}
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
                        role="menuitem"
                        className="flex flex-col items-center gap-1.5 rounded-lg px-2 py-3 text-center transition-colors hover:bg-muted"
                      >
                        <app.Icon className={cn("size-5", app.toneClass)} />
                        <span className="text-xs font-medium">{app.name}</span>
                      </a>
                    ) : (
                      <span
                        key={app.id}
                        role="menuitem"
                        aria-disabled="true"
                        tabIndex={-1}
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

        {notifications ? (
          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              aria-haspopup="menu"
              aria-expanded={notificationsOpen}
              aria-label={`Notifications${notifications.unreadCount > 0 ? ` (${notifications.unreadCount} non lues)` : ""}`}
              onClick={() => {
                const next = !notificationsOpen;
                setNotificationsOpen(next);
                notifications.onOpenChange?.(next);
              }}
            >
              <span className="relative inline-flex">
                <IconBell />
                {notifications.unreadCount > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-attention px-1 text-[10px] font-semibold text-attention-foreground">
                    {notifications.unreadCount}
                  </span>
                ) : null}
              </span>
            </Button>
            {notificationsOpen ? (
              <>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Fermer les notifications"
                  className="fixed inset-0 z-30 cursor-default"
                  onClick={() => {
                    setNotificationsOpen(false);
                    notifications.onOpenChange?.(false);
                  }}
                />
                <div
                  role="menu"
                  className="absolute right-0 z-40 mt-1 max-h-96 w-80 overflow-y-auto rounded-xl border border-border bg-popover shadow-lift"
                >
                  <div className="sticky top-0 flex items-center justify-between gap-2 border-b border-border bg-popover px-3 py-2">
                    <p className="text-sm font-medium">Notifications</p>
                    {notifications.unreadCount > 0 ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        onClick={notifications.onMarkAllRead}
                      >
                        Tout marquer comme lu
                      </button>
                    ) : null}
                  </div>

                  {notifications.items.length === 0 ? (
                    <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                      Aucune notification.
                    </p>
                  ) : (
                    <div className="p-1">
                      {notifications.items.map((item) => {
                        const unread = item.read !== true;
                        const time = timeAgo(item.createdAt);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setNotificationsOpen(false);
                              notifications.onOpenChange?.(false);
                              notifications.onOpenItem(item);
                            }}
                            className="flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted"
                          >
                            <span className="flex w-full items-center gap-2">
                              <span
                                aria-hidden
                                className={cn(
                                  "size-1.5 shrink-0 rounded-full",
                                  unread ? "bg-attention" : "bg-transparent",
                                )}
                              />
                              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                {item.title}
                              </span>
                              {time ? (
                                <span className="shrink-0 text-[10px] text-muted-foreground">
                                  {time}
                                </span>
                              ) : null}
                            </span>
                            {item.body ? (
                              <span className="line-clamp-2 pl-3.5 text-xs text-muted-foreground">
                                {item.body}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        ) : null}

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
                tabIndex={-1}
                aria-label="Fermer le menu du compte"
                className="fixed inset-0 z-30 cursor-default"
                onClick={() => setMenuOpen(false)}
              />
              <div
                role="menu"
                className="absolute right-0 z-40 mt-1 w-72 rounded-xl border border-border bg-popover p-1 shadow-lift"
              >
                <div className="border-b border-border px-3 py-2">
                  <p className="truncate text-sm font-medium">{user.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                </div>

                {organizations.length > 0 ? (
                  <div className="border-b border-border py-1">
                    <p className="px-3 pb-1 pt-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                      Organisation
                    </p>
                    {organizations.map((org) => (
                      <button
                        key={org.id}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          if (org.id !== activeOrgId) onSwitchOrg(org.id);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                      >
                        <span className="min-w-0 flex-1 truncate">{org.name}</span>
                        {org.id === activeOrgId ? (
                          <IconCheckSquare className="size-3.5 text-primary" />
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : null}

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
