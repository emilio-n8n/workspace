import { createFileRoute, Link } from "@tanstack/react-router";
import type { SuiteAppKey } from "@workspace/config";
import { type DriveEntryView, listRecentFn } from "@workspace/drive/server";
import { createSpreadsheetFn } from "@workspace/sheets/server";
import { createPresentationFn } from "@workspace/slides/server";
import {
  Alert,
  Badge,
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  FileIcon,
  IconCalendar,
  IconCheckSquare,
  IconClose,
  IconFileText,
  IconGrid,
  IconKey,
  IconPresentation,
  IconSearch,
  IconSettings,
  resolveSuiteApps,
} from "@workspace/ui";
import { type ReactNode, useEffect, useState } from "react";
import { getAppUrlsFn, getWorkspaceFn, type WorkspaceInfo } from "../../server/context.ts";
import { getStorageUsageFn } from "../../server/storage.ts";

export const Route = createFileRoute("/app/")({ component: DashboardPage });

type StorageUsage = { usedBytes: number; fileCount: number; quotaBytes: number | null };

/** Raccourci de création en cours (état d'attente par bouton). */
type BusyShortcut = "sheet" | "slides";

function formatBytes(size: number): string {
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} Ko`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

/** Horodatage relatif court : minutes, heures puis jours. */
function formatRelativeTime(iso: string): string {
  const elapsed = Date.now() - Date.parse(iso);
  if (Number.isNaN(elapsed)) return "récemment";
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}

const shortcutCardClass = cn(
  "flex h-full flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left shadow-soft transition-colors hover:bg-muted",
  "disabled:cursor-wait disabled:opacity-60",
);

/** Au-delà, l'espace n'est plus considéré comme « nouveau ». */
const NEW_WORKSPACE_MAX_FILES = 3;

/** Clé locale de masquage du démarrage guidé (valeur « 1 »). */
const ONBOARDING_DISMISSED_KEY = "workspace-onboarding-dismissed";

/** Étape du démarrage guidé. */
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
  const className = buttonVariants({ variant: "outline", size: "sm" });
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
          className="-mr-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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

/** Carte de raccourci : lien de navigation ou action serveur avec état d'attente. */
function ShortcutCard({
  icon,
  label,
  description,
  href,
  onAction,
  busy = false,
  disabled = false,
}: {
  icon: ReactNode;
  label: string;
  description: string;
  href?: string;
  onAction?: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const body = (
    <>
      {icon}
      <span className="font-display text-sm font-semibold">{label}</span>
      <span className="text-xs text-muted-foreground">{busy ? "Création…" : description}</span>
    </>
  );

  if (href) {
    return (
      <a href={href} className={shortcutCardClass}>
        {body}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={onAction}
      disabled={disabled}
      aria-busy={busy}
      className={shortcutCardClass}
    >
      {body}
    </button>
  );
}

function DashboardPage() {
  const [workspace, setWorkspace] = useState<WorkspaceInfo>(null);
  const [urls, setUrls] = useState<Record<SuiteAppKey, string> | null>(null);
  const [storage, setStorage] = useState<StorageUsage | null>(null);
  const [recent, setRecent] = useState<DriveEntryView[] | null>(null);
  const [busyShortcut, setBusyShortcut] = useState<BusyShortcut | null>(null);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
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

  // Bonus, jamais bloquant : un échec masque simplement la section « Reprendre ».
  useEffect(() => {
    void (async () => {
      try {
        setRecent(await listRecentFn({ data: { limit: 5 } }));
      } catch {
        setRecent([]);
      }
    })();
  }, []);

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
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted"
        >
          Réessayer
        </button>
      </div>
    );
  }

  const apps = urls ? resolveSuiteApps(urls) : [];

  // Espace « nouveau » : aucune organisation partagée (proxy du nombre de membres,
  // absent de l'état existant) et au plus trois fichiers.
  const isNewWorkspace =
    workspace !== null &&
    storage !== null &&
    workspace.organizations.length <= 1 &&
    storage.fileCount <= NEW_WORKSPACE_MAX_FILES;

  async function onCreateSpreadsheet(): Promise<void> {
    if (!urls || busyShortcut !== null) return;
    setBusyShortcut("sheet");
    setShortcutError(null);
    try {
      const created = await createSpreadsheetFn({
        data: { parentFolderId: null, title: "Feuille sans titre" },
      });
      window.location.assign(`${urls.sheets}/sheet/${created.fileId}`);
    } catch (caught) {
      setShortcutError(
        caught instanceof Error ? caught.message : "Création de la feuille impossible.",
      );
    } finally {
      setBusyShortcut(null);
    }
  }

  async function onCreatePresentation(): Promise<void> {
    if (!urls || busyShortcut !== null) return;
    setBusyShortcut("slides");
    setShortcutError(null);
    try {
      const created = await createPresentationFn({
        data: { parentFolderId: null, title: "Présentation sans titre" },
      });
      window.location.assign(`${urls.slides}/slide/${created.fileId}`);
    } catch (caught) {
      setShortcutError(
        caught instanceof Error ? caught.message : "Création de la présentation impossible.",
      );
    } finally {
      setBusyShortcut(null);
    }
  }

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

      <Link
        to="/app/recherche"
        className="flex h-9 items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground hover:bg-muted"
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

      <section aria-label="Raccourcis" className="flex flex-col gap-3">
        <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Raccourcis
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <ShortcutCard
            icon={<IconGrid className="size-5 text-app-sheets" />}
            label="Nouvelle feuille de calcul"
            description="Tableur collaboratif"
            onAction={() => void onCreateSpreadsheet()}
            busy={busyShortcut === "sheet"}
            disabled={urls === null || busyShortcut !== null}
          />
          <ShortcutCard
            icon={<IconPresentation className="size-5 text-app-slides" />}
            label="Nouvelle présentation"
            description="Diaporama collaboratif"
            onAction={() => void onCreatePresentation()}
            busy={busyShortcut === "slides"}
            disabled={urls === null || busyShortcut !== null}
          />
          <ShortcutCard
            icon={<IconCalendar className="size-5 text-app-calendar" />}
            label="Nouvel événement"
            description="Ouvrir l'agenda"
            href={urls ? `${urls.calendar}/` : undefined}
            disabled={urls === null}
          />
          <ShortcutCard
            icon={<IconCheckSquare className="size-5 text-app-tasks" />}
            label="Nouvelle tâche"
            description="Ouvrir les tâches"
            href={urls ? `${urls.tasks}/` : undefined}
            disabled={urls === null}
          />
        </div>
        {shortcutError ? (
          <Alert tone="danger" title="Création impossible">
            {shortcutError}
          </Alert>
        ) : null}
      </section>

      {recent === null || urls === null ? (
        <section aria-label="Reprendre" className="flex flex-col gap-3">
          <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Reprendre
          </h2>
          <div className="flex flex-col gap-2">
            <div className="h-9 animate-pulse rounded-md bg-muted" />
            <div className="h-9 animate-pulse rounded-md bg-muted" />
            <div className="h-9 animate-pulse rounded-md bg-muted" />
          </div>
        </section>
      ) : recent.length > 0 ? (
        <section aria-label="Reprendre" className="flex flex-col gap-3">
          <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Reprendre
          </h2>
          <ul className="flex flex-col gap-2">
            {recent.map((entry) => (
              <li key={entry.id}>
                <a
                  href={`${urls.drive}/`}
                  className="flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm transition-colors hover:bg-muted"
                >
                  <FileIcon kind={entry.kind} mimeType={entry.mimeType} name={entry.name} />
                  <span className="truncate font-medium">{entry.name}</span>
                  <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                    modifié {formatRelativeTime(entry.updatedAt)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
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
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Voir l'historique →
            </Link>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
