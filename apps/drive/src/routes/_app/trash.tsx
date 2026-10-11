import { createFileRoute, Link } from "@tanstack/react-router";
import {
  type DriveEntryView,
  listTrashFn,
  purgeEntryFn,
  restoreEntryFn,
} from "@workspace/drive/server";
import { Badge, Button, Card, Dialog, IconFileText, IconFolder, IconTrash } from "@workspace/ui";
import { useCallback, useEffect, useState } from "react";

export const Route = createFileRoute("/_app/trash")({ component: TrashPage });

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

function TrashPage() {
  const [entries, setEntries] = useState<DriveEntryView[] | null>(null);
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
    } finally {
      setBusy(false);
    }
  }

  async function onPurge() {
    if (!purgeTarget) return;
    setBusy(true);
    try {
      await purgeEntryFn({ data: { entryId: purgeTarget.id } });
      setPurgeTarget(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <header className="flex items-center gap-3">
        <IconTrash />
        <h1 className="flex-1 text-xl font-semibold tracking-tight">Corbeille</h1>
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Retour au Drive
        </Link>
      </header>

      <p className="text-sm text-muted-foreground">
        Les éléments de la corbeille restent stockés jusqu'à leur purge définitive. La restauration
        les replace à leur emplacement d'origine.
      </p>

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
                  Purger
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={purgeTarget !== null}
        onClose={() => setPurgeTarget(null)}
        title={purgeTarget ? `Purger « ${purgeTarget.name} » ?` : "Purger"}
      >
        <p className="text-sm text-muted-foreground">
          Cette action est définitive : le contenu sera supprimé du stockage et ne pourra plus être
          restauré.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setPurgeTarget(null)}>
            Annuler
          </Button>
          <Button variant="destructive" loading={busy} onClick={() => void onPurge()}>
            Purger définitivement
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
