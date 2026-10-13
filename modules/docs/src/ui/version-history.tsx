import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  IconClose,
  Toasts,
  useToasts,
} from "@workspace/ui";
import { useCallback, useEffect, useState } from "react";
import { type PmNode, toPlainText } from "../export.ts";
import {
  getDocumentVersionFn,
  listDocumentVersionsFn,
  restoreDocumentVersionFn,
} from "../server.ts";

export type VersionHistoryProps = {
  fileId: string;
  /** Rôle write : affiche « Restaurer » ; un viewer prévisualise seulement. */
  canEdit?: boolean;
  /** Après une restauration réussie — l'hôte recharge le document. */
  onRestored?: () => void;
};

type VersionSummary = {
  id: string;
  version: number;
  createdAt: string;
  createdBy?: string;
};

/** Icône horloge — même géométrie stroke 16 px que les icônes du design system. */
function ClockIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  );
}

const relativeTime = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });

/** Date relative en français (« il y a 5 minutes », « hier »…), sans dépendance. */
function formatRelativeTime(iso: string): string {
  const elapsedSeconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (Math.abs(elapsedSeconds) < 45) return "à l'instant";
  const minutes = Math.round(elapsedSeconds / 60);
  if (Math.abs(minutes) < 60) return relativeTime.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relativeTime.format(-hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return relativeTime.format(-days, "day");
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return relativeTime.format(-months, "month");
  return relativeTime.format(-Math.round(months / 12), "year");
}

function formatAbsoluteTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Texte simple d'une version : le contenu est un document ProseMirror (JSON),
 * aplati sans balises ; toute autre forme retombe sur du texte ou du JSON.
 */
function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content && typeof content === "object") {
    const node = content as PmNode;
    if (typeof node.type === "string") return toPlainText(node);
    return JSON.stringify(content, null, 2);
  }
  return "";
}

/**
 * Panneau « Historique des versions » : liste des versions (date relative FR,
 * auteur), aperçu en texte simple, et restauration (rôle write) avec
 * confirmation. Le panneau est un `aside` fixé à droite — pas de Sheet dans le
 * design system. Toute erreur réseau est signalée en français par un toast.
 */
export function VersionHistory({ fileId, canEdit = false, onRestored }: VersionHistoryProps) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ version: number; text: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState<number | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<VersionSummary | null>(null);
  const [restoring, setRestoring] = useState(false);
  const { toasts, push, dismiss } = useToasts();

  const loadVersions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setVersions(await listDocumentVersionsFn({ data: { fileId } }));
    } catch {
      const message = "Impossible de charger l'historique des versions.";
      // Bandeau persistant dans le panneau + toast immédiat (contrat réseau).
      setError(message);
      push("danger", message);
    } finally {
      setLoading(false);
    }
  }, [fileId, push]);

  // Rechargement à chaque ouverture (et au changement de document) : les
  // versions peuvent avoir été créées depuis un autre onglet.
  useEffect(() => {
    if (open) void loadVersions();
  }, [open, loadVersions]);

  async function onPreview(version: VersionSummary) {
    setPreviewLoading(version.version);
    try {
      const stored = await getDocumentVersionFn({ data: { fileId, version: version.version } });
      setPreview({ version: stored.version, text: contentToText(stored.content) });
    } catch {
      push("danger", "Impossible de charger l'aperçu de cette version.");
    } finally {
      setPreviewLoading(null);
    }
  }

  async function onConfirmRestore() {
    if (!restoreTarget) return;
    const target = restoreTarget;
    setRestoring(true);
    try {
      await restoreDocumentVersionFn({ data: { fileId, version: target.version } });
      setRestoreTarget(null);
      push("success", `Version ${target.version} restaurée.`);
      await loadVersions();
      onRestored?.();
    } catch {
      push("danger", "Impossible de restaurer cette version.");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <>
      <Button
        variant={open ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={open}
        onClick={() => setOpen((current) => !current)}
      >
        <ClockIcon />
        Historique
      </Button>

      {open ? (
        <aside
          aria-label="Historique des versions"
          className="print-hide fixed inset-y-0 right-0 z-40 flex w-96 max-w-[85vw] flex-col border-l border-border bg-card shadow-lift"
        >
          <header className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-sm font-medium">Historique des versions</p>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Fermer l'historique"
              onClick={() => setOpen(false)}
            >
              <IconClose />
            </Button>
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {error ? (
              <Alert tone="danger" className="text-xs">
                {error}
              </Alert>
            ) : null}

            {versions === null && loading ? (
              <div role="status" aria-label="Chargement de l'historique" className="space-y-2 p-1">
                <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
                <div className="h-3 w-full animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
              </div>
            ) : null}

            {versions !== null && versions.length === 0 ? (
              <EmptyState
                icon={<ClockIcon />}
                title="Aucune version"
                hint="Les instantanés enregistrés apparaîtront ici."
                className="p-4"
              />
            ) : null}

            {versions !== null && versions.length > 0 ? (
              <ul className="space-y-2">
                {versions.map((version) => (
                  <li
                    key={version.id}
                    className="rounded-lg border border-border bg-background p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">v{version.version}</Badge>
                      <span
                        className="text-xs text-muted-foreground"
                        title={formatAbsoluteTime(version.createdAt)}
                      >
                        {formatRelativeTime(version.createdAt)}
                      </span>
                      {version.createdBy ? (
                        <span
                          className="ml-auto text-xs text-muted-foreground"
                          title={version.createdBy}
                        >
                          par {version.createdBy.slice(0, 8)}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-1 flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        loading={previewLoading === version.version}
                        disabled={previewLoading !== null && previewLoading !== version.version}
                        onClick={() => void onPreview(version)}
                      >
                        Aperçu
                      </Button>
                      {canEdit ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          disabled={restoring}
                          onClick={() => setRestoreTarget(version)}
                        >
                          Restaurer
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </aside>
      ) : null}

      <Dialog
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={preview ? `Aperçu — version ${preview.version}` : "Aperçu"}
        className="max-w-2xl"
      >
        <pre className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm">
          {preview && preview.text.length > 0 ? preview.text : "(Document vide.)"}
        </pre>
      </Dialog>

      <ConfirmDialog
        open={restoreTarget !== null}
        onClose={() => setRestoreTarget(null)}
        onConfirm={() => void onConfirmRestore()}
        title={restoreTarget ? `Restaurer la version ${restoreTarget.version} ?` : "Restaurer"}
        message={
          restoreTarget
            ? `Le contenu de la version ${restoreTarget.version} sera recopié dans une nouvelle version. L'historique reste intact : la restauration est elle-même réversible.`
            : ""
        }
        confirmLabel="Restaurer"
        busy={restoring}
      />

      <Toasts toasts={toasts} dismiss={dismiss} />
    </>
  );
}
