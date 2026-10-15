import { createFileRoute, Link } from "@tanstack/react-router";
import type { SuiteAppKey } from "@workspace/config";
import { type DriveEntryView, listRecentFn } from "@workspace/drive/server";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  IconClose,
  IconFileText,
  IconKey,
  IconSearch,
  IconSettings,
  PageHeader,
  resolveSuiteApps,
} from "@workspace/ui";
import { useCallback, useEffect, useState } from "react";
import { formatBytes } from "../../dashboard/format.ts";
import { ShortcutsSection } from "../../dashboard/quick-actions.tsx";
import { RecentFilesSection } from "../../dashboard/recent-files.tsx";
import { Skeleton, SkeletonCard, SkeletonRow } from "../../dashboard/skeleton.tsx";
import { getAppUrlsFn, getWorkspaceFn, type WorkspaceInfo } from "../../server/context.ts";
import { getStorageUsageFn } from "../../server/storage.ts";

export const Route = createFileRoute("/app/")({
  component: DashboardPage,
  head: () => ({
    meta: [
      {
        title: "Tableau de bord — Workspace",
      },
      {
        name: "description",
        content:
          "Tableau de bord : raccourcis, fichiers récents, applications et stockage de votre espace de travail.",
      },
    ],
  }),
});

type StorageUsage = { usedBytes: number; fileCount: number; quotaBytes: number | null };

/** Démarrage guidé — masqué localement dès que l'utilisateur le ferme. */
const NEW_WORKSPACE_MAX_FILES = 3;
const ONBOARDING_DISMISSED_KEY = "workspace-onboarding-dismissed";

type OnboardingStep = {
  label: string;
  description: string;
  Icon: typeof IconFileText;
  done: boolean;
  /** Lien inter-application, nul tant que les URLs ne sont pas chargées. */
  href?: string | null;
  /** Lien interne au routeur. */
  to?: "/app/settings/tokens";
  actionLabel: string;
};

/** Marqueur d'étape : cercle coché une fois l'étape terminée, cercle vide sinon. */
function StepMarker({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-full border",
        done ? "border-primary bg-primary text-primary-foreground" : "border-border",
      )}
    >
      {done ? <span className="text-[10px] leading-none">✓</span> : null}
    </span>
  );
}

/** Action d'une étape : lien interne, lien inter-application, ou bouton en attente des URLs. */
function StepAction({ step }: { step: OnboardingStep }) {
  const className =
    "inline-flex h-8 items-center rounded-md border border-border px-3 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none";
  if (step.to) {
    return (
      <Link to={step.to} className={className}>
        {step.actionLabel}
      </Link>
    );
  }
  if (step.href) {
    return (
      <a href={step.href} className={className}>
        {step.actionLabel}
      </a>
    );
  }
  return (
    <button type="button" disabled className={className}>
      {step.actionLabel}
    </button>
  );
}

/**
 * Démarrage guidé : affiché uniquement sur un espace encore vierge, masquable
 * localement. Chaque étape se coche à partir de données réelles quand elles
 * sont disponibles.
 */
function OnboardingCard({
  urls,
  fileCount,
  onDismiss,
}: {
  urls: Record<SuiteAppKey, string> | null;
  fileCount: number | null;
  onDismiss: () => void;
}) {
  const steps: OnboardingStep[] = [
    {
      label: "Créez votre premier document",
      description: "Feuilles, présentations et docs vivent dans Drive.",
      Icon: IconFileText,
      done: (fileCount ?? 0) > NEW_WORKSPACE_MAX_FILES,
      href: urls ? `${urls.docs}/` : null,
      actionLabel: "Ouvrir Docs",
    },
    {
      label: "Invitez un collègue",
      description: "Ajoutez des membres à votre espace depuis l'administration.",
      Icon: IconSettings,
      done: false,
      href: urls ? `${urls.admin}/` : null,
      actionLabel: "Ouvrir Admin",
    },
    {
      label: "Connectez un agent IA",
      description: "Générez un jeton à privilèges minimaux pour un agent compatible MCP.",
      Icon: IconKey,
      done: false,
      to: "/app/settings/tokens",
      actionLabel: "Gérer les jetons",
    },
  ];

  return (
    <section
      aria-labelledby="onboarding-title"
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-soft"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="onboarding-title" className="font-display text-base font-semibold">
            Bienvenue dans Workspace
          </h2>
          <p className="text-xs text-muted-foreground">
            Trois étapes pour un espace utile en trois minutes.
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Fermer"
          className="-mr-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
        >
          <IconClose className="size-4" />
        </button>
      </div>

      <ul className="flex flex-col gap-2">
        {steps.map((step) => (
          <li
            key={step.label}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border/60 px-3 py-2"
          >
            <StepMarker done={step.done} />
            <step.Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="sr-only">{step.done ? "Terminé — " : "À faire — "}</span>
              <span className="truncate text-sm font-medium">{step.label}</span>
              <span className="text-xs text-muted-foreground">{step.description}</span>
            </span>
            <StepAction step={step} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function DashboardPage() {
  const [workspace, setWorkspace] = useState<WorkspaceInfo>(null);
  const [urls, setUrls] = useState<Record<SuiteAppKey, string> | null>(null);
  const [storage, setStorage] = useState<StorageUsage | null>(null);
  const [recent, setRecent] = useState<DriveEntryView[] | null>(null);
  /** `true` quand la liste « Reprendre » échoue : le reste de la page tient. */
  const [recentFailed, setRecentFailed] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
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

  /**
   * Fichiers récents — chargement séparé et jamais bloquant : un échec vide la
   * liste et arme l'état d'erreur, le reste du tableau de bord s'affiche.
   */
  const reloadRecent = useCallback(async () => {
    try {
      setRecent(await listRecentFn({ data: { limit: 50 } }));
      setRecentFailed(false);
    } catch {
      setRecent([]);
      setRecentFailed(true);
    }
  }, []);

  useEffect(() => {
    void reloadRecent();
  }, [reloadRecent]);

  // Lecture paresseuse côté client uniquement : le rendu SSR ne touche jamais à window.
  useEffect(() => {
    try {
      setOnboardingDismissed(window.localStorage.getItem(ONBOARDING_DISMISSED_KEY) === "1");
    } catch {
      // Stockage indisponible (navigation privée, cookies bloqués) : la carte reste visible.
    }
  }, []);

  /** Masque le démarrage guidé et mémorise le choix localement. */
  function dismissOnboarding(): void {
    setOnboardingDismissed(true);
    try {
      window.localStorage.setItem(ONBOARDING_DISMISSED_KEY, "1");
    } catch {
      // Repli : masquée pour la session en cours seulement.
    }
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-destructive">Impossible de charger votre espace de travail.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Réessayer
        </button>
      </div>
    );
  }

  if (!workspace || !urls) {
    // Squelettes : chaque bloc reprend la hauteur de son contenu final, la page
    // ne bouge pas quand les données arrivent.
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6" aria-busy="true">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-5 w-72" />
        </div>
        <Skeleton className="h-9 w-full rounded-lg" />

        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-80" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <SkeletonCard key={index} />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-80" />
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((index) => (
              <SkeletonRow key={index} />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-28" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
              <SkeletonCard key={index} />
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-32 rounded-xl" />
          ))}
        </div>

        <p role="status" className="sr-only">
          Chargement de votre espace de travail…
        </p>
      </div>
    );
  }

  const apps = resolveSuiteApps(urls, workspace.activeOrganization?.kind);

  // Espace « nouveau » : aucune organisation partagée (proxy du nombre de membres,
  // absent de l'état existant) et au plus trois fichiers.
  const isNewWorkspace =
    workspace !== null &&
    storage !== null &&
    workspace.organizations.length <= 1 &&
    storage.fileCount <= NEW_WORKSPACE_MAX_FILES;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title={`Bonjour ${workspace.user.name.split(" ")[0]}`}
        description={`Votre espace de travail${
          workspace.activeOrganization ? ` — ${workspace.activeOrganization.name}` : ""
        }.`}
      />

      <Link
        to="/app/recherche"
        className="flex h-9 items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
      >
        <IconSearch className="size-4" />
        Rechercher dans toute la suite…
      </Link>

      {isNewWorkspace && !onboardingDismissed ? (
        <OnboardingCard
          urls={urls}
          fileCount={storage?.fileCount ?? null}
          onDismiss={dismissOnboarding}
        />
      ) : null}

      <ShortcutsSection urls={urls} />

      <RecentFilesSection
        entries={recent}
        loading={recent === null}
        failed={recentFailed}
        onRetry={() => void reloadRecent()}
        urls={urls}
      />

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
                  className="flex h-full flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-soft transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
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

      <section aria-label="Votre espace" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stockage</CardTitle>
            <CardDescription className="tabular-nums">
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
              className="rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Gérer les jetons →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notifications</CardTitle>
            <CardDescription>
              Partages, tâches assignées et notes — la cloche est en haut de chaque application.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              to="/app/notifications"
              className="rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Voir l'historique →
            </Link>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
