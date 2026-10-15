import { createFileRoute, Link } from "@tanstack/react-router";
import {
  type DriveEntryView,
  emptyTrashFn,
  listTrashFn,
  purgeEntryFn,
  restoreEntryFn,
} from "@workspace/drive/server";
import {
  emptyTrashFailure,
  emptyTrashLabel,
  emptyTrashMessage,
  emptyTrashResult,
  purgedMessage,
  purgeEntryMessage,
  purgeFailure,
  restoredMessage,
  restoreFailure,
} from "@workspace/drive/ui";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  IconFileText,
  IconFolder,
  IconTrash,
  Toasts,
  useToasts,
} from "@workspace/ui";
import { useCallback, useEffect, useState } from "react";

export const Route = createFileRoute("/_app/trash")({ component: TrashPage });

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

function TrashPage() {
  const { toasts, push, dismiss } = useToasts();
  const [entries, setEntries] = useState<DriveEntryView[] | null>(null);
  const [emptyOpen, setEmptyOpen] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState<DriveEntryView | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setEntries(await listTrashFn());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onRestore(entry: DriveEntryView) {
    setBusy(true);
    try {
      await restoreEntryFn({ data: { entryId: entry.id } });
      await refresh();
      push("success", restoredMessage(entry.name));
    } catch {
      // Le message nomme l'élément : l'utilisateur sait exactement quoi relancer.
      push("danger", restoreFailure(entry.name));
    } finally {
      setBusy(false);
    }
  }

  async function onPurge() {
    if (!purgeTarget) return;
    const target = purgeTarget;
    setBusy(true);
    try {
      await purgeEntryFn({ data: { entryId: target.id } });
      setPurgeTarget(null);
      await refresh();
      push("success", purgedMessage(target.name));
    } catch {
      push("danger", purgeFailure(target.name));
    } finally {
      setBusy(false);
    }
  }

  async function onEmptyTrash() {
    setBusy(true);
    try {
      const result = await emptyTrashFn();
      setEmptyOpen(false);
      await refresh();
      push(
        result.failures.length === 0 ? "success" : "danger",
        emptyTrashResult(result.purged.length, result.failures.length),
      );
    } catch {
      push("danger", emptyTrashFailure());
    } finally {
      setBusy(false);
    }
  }

  const count = entries?.length ?? 0;

  return (
    <div className="drive-shell flex h-full min-h-0 flex-col gap-4 p-4 md:p-6">
      <header className="flex shrink-0 flex-wrap items-center gap-3">
        <IconTrash />
        <h1 className="flex-1 text-xl font-semibold tracking-tight">Corbeille</h1>
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Retour au Drive
        </Link>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          Les éléments de la corbeille restent stockés jusqu'à leur suppression définitive. La
          restauration les replace à leur emplacement d'origine.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive"
          disabled={busy || count === 0}
          onClick={() => setEmptyOpen(true)}
        >
          {emptyTrashLabel(count)}
        </Button>
      </div>

      {/* Seule la liste défile : l'en-tête et les commandes restent en place. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {entries === null ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : entries.length === 0 ? (
          <Card>
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              La corbeille est vide.
            </div>
          </Card>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {entries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                <span className="text-muted-foreground">
                  {entry.kind === "folder" ? <IconFolder /> : <IconFileText />}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.name}</span>
                <Badge variant="default">{entry.kind === "folder" ? "Dossier" : "Fichier"}</Badge>
                <span className="text-xs text-muted-foreground">{formatDate(entry.updatedAt)}</span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void onRestore(entry)}
                  >
                    Restaurer
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setPurgeTarget(entry)}
                  >
                    Supprimer
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Vidage : la confirmation nomme le nombre d'éléments et l'irréversibilité. */}
      <ConfirmDialog
        open={emptyOpen}
        onClose={() => setEmptyOpen(false)}
        onConfirm={() => void onEmptyTrash()}
        title="Vider la corbeille ?"
        message={emptyTrashMessage(count)}
        confirmLabel="Vider définitivement"
        destructive
        busy={busy}
      />

      <ConfirmDialog
        open={purgeTarget !== null}
        onClose={() => setPurgeTarget(null)}
        onConfirm={() => void onPurge()}
        title={purgeTarget ? `Supprimer « ${purgeTarget.name} » ?` : "Supprimer"}
        message={purgeTarget ? purgeEntryMessage(purgeTarget.name) : ""}
        confirmLabel="Supprimer définitivement"
        destructive
        busy={busy}
      />

      <Toasts toasts={toasts} dismiss={dismiss} />
    </div>
  );
}
