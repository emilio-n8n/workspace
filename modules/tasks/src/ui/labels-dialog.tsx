import { Button, ConfirmDialog, cn, Dialog, EmptyState, Input, Label } from "@workspace/ui";
import type { FormEvent } from "react";
import { useState } from "react";
import type { TaskLabelColor } from "../schema.ts";
import type { TaskLabelView } from "../server.ts";
import { LABEL_COLOR_LABELS, labelDotClass, TASK_LABEL_COLOR_VALUES } from "./task-visuals.tsx";

/**
 * Gestion des étiquettes de l'organisation : créer, renommer, recolorer,
 * supprimer. Les couleurs sont proposées dans une liste `<select>` étiquetée —
 * la couleur reste une information secondaire, le nom porte le sens.
 */
export function LabelsDialog({
  labels,
  open,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: {
  labels: TaskLabelView[];
  open: boolean;
  onClose: () => void;
  /** Renvoie l'identifiant de l'étiquette créée, ou `null` en cas d'échec. */
  onCreate: (name: string, color: TaskLabelColor) => Promise<string | null>;
  onUpdate: (labelId: string, patch: { name?: string; color?: string }) => Promise<boolean>;
  onDelete: (labelId: string) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<TaskLabelColor>("blue");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<TaskLabelView | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = name.trim();
    if (clean.length === 0 || creating) return;

    setCreating(true);
    setMessage(null);
    const createdId = await onCreate(clean, color);
    setCreating(false);
    if (createdId) {
      setName("");
      setMessage(`Étiquette « ${clean} » créée.`);
    } else {
      setMessage("Création impossible : ce nom est peut-être déjà pris.");
    }
  }

  async function submitRename(labelId: string) {
    const clean = editingName.trim();
    if (clean.length === 0 || busy) return;

    setBusy(true);
    const ok = await onUpdate(labelId, { name: clean });
    setBusy(false);
    if (ok) {
      setEditingId(null);
      setMessage(`Étiquette renommée en « ${clean} ».`);
    } else {
      setMessage("Renommage impossible : ce nom est peut-être déjà pris.");
    }
  }

  async function changeColor(labelId: string, next: string) {
    setBusy(true);
    const ok = await onUpdate(labelId, { color: next });
    setBusy(false);
    setMessage(ok ? "Couleur mise à jour." : "Mise à jour de la couleur impossible.");
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    const ok = await onDelete(deleteTarget.id);
    setBusy(false);
    if (ok) {
      setMessage(`Étiquette « ${deleteTarget.name} » supprimée.`);
      setDeleteTarget(null);
    } else {
      setMessage("Suppression impossible.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Étiquettes" className="max-w-xl">
      <div className="flex flex-col gap-5">
        <p className="text-sm text-muted-foreground">
          Les étiquettes sont partagées par toutes les listes de votre organisation. Supprimer une
          étiquette la retire des tâches qui la portent, sans supprimer les tâches.
        </p>

        {labels.length === 0 ? (
          <EmptyState
            title="Aucune étiquette"
            hint="Créez une étiquette pour qualifier vos tâches : urgent, client, perso…"
            className="border-0 bg-transparent p-0 text-sm"
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {labels.map((label) => (
              <li key={label.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                {editingId === label.id ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitRename(label.id);
                    }}
                    method="post"
                    className="flex min-w-0 flex-1 items-center gap-2"
                  >
                    <Label htmlFor={`rename-label-${label.id}`} className="sr-only">
                      Nouveau nom de l'étiquette
                    </Label>
                    <Input
                      id={`rename-label-${label.id}`}
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      maxLength={40}
                      disabled={busy}
                      autoFocus
                    />
                    <Button type="submit" size="sm" loading={busy}>
                      Enregistrer
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingId(null)}
                    >
                      Annuler
                    </Button>
                  </form>
                ) : (
                  <>
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span
                        aria-hidden
                        className={cn("size-2.5 shrink-0 rounded-full", labelDotClass(label.color))}
                      />
                      <span className="truncate text-sm">{label.name}</span>
                    </span>
                    <Label htmlFor={`label-color-${label.id}`} className="sr-only">
                      Couleur de l'étiquette {label.name}
                    </Label>
                    <select
                      id={`label-color-${label.id}`}
                      value={label.color}
                      onChange={(event) => void changeColor(label.id, event.target.value)}
                      disabled={busy}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      {TASK_LABEL_COLOR_VALUES.map((value) => (
                        <option key={value} value={value}>
                          {LABEL_COLOR_LABELS[value]}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setEditingId(label.id);
                        setEditingName(label.name);
                        setMessage(null);
                      }}
                    >
                      Renommer
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      disabled={busy}
                      aria-label={`Supprimer l'étiquette ${label.name}`}
                      onClick={() => setDeleteTarget(label)}
                    >
                      Supprimer
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={submitCreate}
          method="post"
          aria-busy={creating || undefined}
          className="flex flex-wrap items-end gap-2 border-t border-border pt-4"
        >
          <div className="flex min-w-40 flex-1 flex-col gap-1.5">
            <Label htmlFor="dialog-new-label-name" className="text-xs">
              Nouvelle étiquette
            </Label>
            <Input
              id="dialog-new-label-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Urgent"
              maxLength={40}
              disabled={creating}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dialog-new-label-color" className="text-xs">
              Couleur
            </Label>
            <select
              id="dialog-new-label-color"
              value={color}
              onChange={(event) => setColor(event.target.value as TaskLabelColor)}
              disabled={creating}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {TASK_LABEL_COLOR_VALUES.map((value) => (
                <option key={value} value={value}>
                  {LABEL_COLOR_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" loading={creating} disabled={name.trim().length === 0}>
            Créer l'étiquette
          </Button>
        </form>

        <p role="status" className="min-h-4 text-xs text-muted-foreground">
          {message ?? ""}
        </p>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
        title="Supprimer l'étiquette ?"
        message={
          deleteTarget
            ? `« ${deleteTarget.name} » sera retirée de toutes les tâches qui la portent.`
            : "Cette étiquette sera retirée des tâches qui la portent."
        }
        confirmLabel="Supprimer"
        busy={busy}
        destructive
      />
    </Dialog>
  );
}
