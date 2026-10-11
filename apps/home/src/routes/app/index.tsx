import { createFileRoute, Link } from "@tanstack/react-router";
import type { SuiteAppKey } from "@workspace/config";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  resolveSuiteApps,
} from "@workspace/ui";
import { useEffect, useState } from "react";
import { getAppUrlsFn, getWorkspaceFn, type WorkspaceInfo } from "../../server/context.ts";
import { getStorageUsageFn } from "../../server/storage.ts";

export const Route = createFileRoute("/app/")({ component: DashboardPage });

type StorageUsage = { usedBytes: number; fileCount: number; quotaBytes: number | null };

function formatBytes(size: number): string {
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} Ko`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

function DashboardPage() {
  const [workspace, setWorkspace] = useState<WorkspaceInfo>(null);
  const [urls, setUrls] = useState<Record<SuiteAppKey, string> | null>(null);
  const [storage, setStorage] = useState<StorageUsage | null>(null);

  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [data, appUrls, usage] = await Promise.all([
          getWorkspaceFn(),
          getAppUrlsFn(),
          getStorageUsageFn(),
        ]);
        setWorkspace(data);
        setUrls(appUrls);
        setStorage(usage);
      } catch {
        setLoadError(true);
      }
    })();
  }, []);

  if (loadError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-destructive">Impossible de charger votre espace de travail.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted"
        >
          Réessayer
        </button>
      </div>
    );
  }

  const apps = urls ? resolveSuiteApps(urls) : [];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {workspace ? `Bonjour ${workspace.user.name.split(" ")[0]}` : "Chargement…"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Votre espace de travail
          {workspace?.activeOrganization ? ` — ${workspace.activeOrganization.name}` : ""}.
        </p>
      </header>

      <section aria-label="Applications" className="flex flex-col gap-3">
        <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Applications
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {apps.map((app) => (
            <li key={app.id}>
              {app.shipped && app.href ? (
                <a
                  href={app.href}
                  className="flex h-full flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-soft transition-colors hover:bg-muted"
                >
                  <app.Icon className={cn("size-5", app.toneClass)} />
                  <span className="font-display text-sm font-semibold">{app.name}</span>
                  <span className="text-xs text-muted-foreground">{app.description}</span>
                </a>
              ) : (
                <span className="flex h-full cursor-not-allowed flex-col gap-2 rounded-xl border border-border/60 bg-card/60 p-4 opacity-60">
                  <app.Icon className={cn("size-5", app.toneClass)} />
                  <span className="flex items-center gap-2 font-display text-sm font-semibold">
                    {app.name}
                    <Badge variant="outline" className="text-[10px]">
                      Phase {app.phase}
                    </Badge>
                  </span>
                  <span className="text-xs text-muted-foreground">{app.description}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Stockage" className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stockage</CardTitle>
            <CardDescription>
              {storage
                ? `${formatBytes(storage.usedBytes)} utilisés · ${storage.fileCount} fichier(s)`
                : "…"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {storage?.quotaBytes ? (
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${Math.min(100, (storage.usedBytes / storage.quotaBytes) * 100)}%`,
                  }}
                />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Quota non configuré — espace illimité.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Agents & jetons</CardTitle>
            <CardDescription>
              Connectez des agents IA compatibles MCP avec des permissions minimales.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              to="/app/settings/tokens"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Gérer les jetons →
            </Link>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
