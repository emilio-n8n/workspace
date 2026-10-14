import { Button, Dialog, IconFolder, IconTrash, LoadingState } from "@workspace/ui";
import { useCallback, useEffect, useState } from "react";
import { type DriveEntryView, listMoveTargetsFn } from "../server.ts";
import { selectionLabel } from "./selection.ts";

/** Nombre maximal de dossiers affichés avant défilement dans le dialogue. */
const TARGET_LIST_MAX_HEIGHT = "max-h-72";

export type SelectionActionBarProps = {
  /** Nombre d'éléments sélectionnés. */
  count: number;
  /** Nombre d'éléments réellement téléchargeables parmi la sélection. */
  downloadCount: number;
  /** Bloque les actions groupées pendant qu'une requête est en vol. */
  busy: boolean;
  onClear: () => void;
  onDownload: () => void;
  onMove: () => void;
  onDelete: () => void;
};

/**
 * Barre d'actions de la sélection multiple : apparue dès qu'un élément est
 * sélectionné, elle remplace les commandes de la barre d'outils et rend le
 * focus visible sur ce qu'il va arriver à la sélection. Chaque action est
 * désactivée — et expliquée — quand elle ne peut pas s'appliquer.
 */
export function SelectionActionBar({
  count,
  downloadCount,
  busy,
  onClear,
  onDownload,
  onMove,
  onDelete,
}: SelectionActionBarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Actions de la sélection"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-accent/40 px-3 py-2"
    >
      <p aria-live="polite" className="text-sm font-medium">
        {selectionLabel(count)}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onDownload}
          disabled={busy || downloadCount === 0}
        >
          Télécharger
          {downloadCount > 0 ? (
            <span className="text-muted-foreground">({downloadCount})</span>
          ) : null}
        </Button>
        <Button size="sm" variant="outline" onClick={onMove} disabled={busy}>
          Déplacer
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDelete}
          disabled={busy}
          className="text-destructive"
        >
          <IconTrash />
          Supprimer
        </Button>
      </div>
      <Button size="sm" variant="ghost" onClick={onClear} disabled={busy} className="ml-auto">
        Tout désélectionner
      </Button>
      {downloadCount === 0 ? (
        <p className="w-full text-xs text-muted-foreground">
          Les dossiers et les fichiers ouverts par une autre application (Documents, Feuilles,
          Présentations, Formulaires) ne se téléchargent pas depuis le Drive.
        </p>
      ) : null}
    </div>
  );
}

export type MoveDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Éléments à déplacer (leurs dossiers sont écartés des cibles). */
  entries: DriveEntryView[];
  busy: boolean;
  onConfirm: (targetParentId: string | null) => void;
};

type TargetsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; folders: DriveEntryView[] };

/**
 * Dialogue « Déplacer la sélection » : destination choisie parmi les dossiers
 * accessibles en écriture (racine comprise), présentée en boutons radio
 * natifs — donc entièrement manoeuvrables au clavier.
 */
export function MoveDialog({ open, onClose, entries, busy, onConfirm }: MoveDialogProps) {
  const [state, setState] = useState<TargetsState>({ status: "loading" });
  const [target, setTarget] = useState<string>("root");

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const folders = await listMoveTargetsFn({
        data: { excludeIds: entries.map((entry) => entry.id) },
      });
      setState({ status: "ready", folders });
    } catch {
      setState({ status: "error" });
    }
  }, [entries]);

  useEffect(() => {
    if (!open) return;
    setTarget("root");
    void load();
  }, [open, load]);

  const folders = state.status === "ready" ? state.folders : [];
  const choice = target === "root" ? null : target;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Déplacer la sélection"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button onClick={() => onConfirm(choice)} loading={busy}>
            Déplacer ici
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        {selectionLabel(entries.length)} — choisissez le dossier de destination.
      </p>

      {state.status === "loading" ? (
        <LoadingState className="py-6" label="Chargement des dossiers…" size={20} />
      ) : state.status === "error" ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <p role="alert" className="text-sm text-destructive">
            Impossible de charger les dossiers de destination.
          </p>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Réessayer
          </Button>
        </div>
      ) : (
        <fieldset className="mt-3" disabled={busy}>
          <legend className="sr-only">Dossier de destination</legend>
          <ul
            className={`flex flex-col gap-1 overflow-y-auto rounded-md border border-border p-1 ${TARGET_LIST_MAX_HEIGHT}`}
          >
            <li>
              <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted">
                <input
                  type="radio"
                  name="move-target"
                  value="root"
                  checked={target === "root"}
                  onChange={() => setTarget("root")}
                  className="accent-primary"
                />
                <IconFolder />
                <span className="font-medium">Mon Drive (racine)</span>
              </label>
            </li>
            {folders.map((folder) => (
              <li key={folder.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted">
                  <input
                    type="radio"
                    name="move-target"
                    value={folder.id}
                    checked={target === folder.id}
                    onChange={() => setTarget(folder.id)}
                    className="accent-primary"
                  />
                  <IconFolder />
                  <span className="min-w-0 truncate">{folder.name}</span>
                </label>
              </li>
            ))}
            {folders.length === 0 ? (
              <li className="px-2 py-3 text-center text-sm text-muted-foreground">
                Aucun autre dossier accessible en écriture.
              </li>
            ) : null}
          </ul>
        </fieldset>
      )}
    </Dialog>
  );
}
