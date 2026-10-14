import {
  Alert,
  Button,
  cn,
  Dialog,
  EmptyState,
  IconCheckSquare,
  IconGrid,
  Input,
  Label,
  LoadingState,
} from "@workspace/ui";
import type { FormEvent } from "react";
import { useState } from "react";
import type { TaskListView } from "../server.ts";

/**
 * Panneau latéral des listes — créer, renommer, ordonner.
 *
 * Les trois actions sont disponibles au clavier comme à la souris : les
 * boutons « Monter » / « Descendre » sont de vrais boutons étiquetés (pas de
 * glisser-déposer, réservé à une mission dédiée), et chaque déplacement est
 * annoncé dans une région `aria-live`. L'ordre est partagé par toute
 * l'organisation : il exige le droit d'écriture sur chaque liste.
 */

export type ListsSidebarProps = {
  lists: TaskListView[] | null;
  error: string | null;
  activeListId: string | null;
  showMyTasks: boolean;
  onSelectList: (listId: string) => void;
  onShowMyTasks: () => void;
  onCreateList: (name: string) => Promise<boolean>;
  onRenameList: (listId: string, name: string) => Promise<boolean>;
  onReorderLists: (listIds: string[]) => Promise<boolean>;
  onRetry: () => Promise<void>;
};

export function ListsSidebar({
  lists,
  error,
  activeListId,
  showMyTasks,
  onSelectList,
  onShowMyTasks,
  onCreateList,
  onRenameList,
  onReorderLists,
  onRetry,
}: ListsSidebarProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<TaskListView | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = name.trim();
    if (clean.length === 0 || creatingBusy) return;

    setCreatingBusy(true);
    setFormError(null);
    const ok = await onCreateList(clean);
    setCreatingBusy(false);
    if (ok) {
      setName("");
      setCreating(false);
      setAnnouncement(`Liste « ${clean} » créée.`);
    } else {
      setFormError("Création impossible. Vérifiez le nom et réessayez.");
    }
  }

  /** Décale une liste d'un cran et persiste l'ordre complet du panneau. */
  async function move(listId: string, delta: -1 | 1) {
    if (!lists) return;
    const index = lists.findIndex((list) => list.id === listId);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= lists.length) return;

    const moved = lists[index];
    if (!moved) return;
    const next = [...lists];
    next.splice(index, 1);
    next.splice(target, 0, moved);

    setMovingId(listId);
    const ok = await onReorderLists(next.map((list) => list.id));
    setMovingId(null);
    if (ok) {
      setAnnouncement(`« ${moved.name} » déplacée en position ${target + 1} sur ${next.length}.`);
    } else {
      setAnnouncement(`Déplacement de « ${moved.name} » impossible.`);
    }
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">Listes</h2>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={creating}
          aria-controls="new-list-form"
          onClick={() => {
            setCreating((current) => !current);
            setFormError(null);
          }}
        >
          Nouvelle liste
        </Button>
      </div>

      {creating ? (
        <form
          id="new-list-form"
          onSubmit={submitCreate}
          method="post"
          aria-busy={creatingBusy || undefined}
          className="flex flex-col gap-2 border-b border-border p-2"
        >
          <Label htmlFor="new-list-name">Nom de la liste</Label>
          <Input
            id="new-list-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Projet 2026"
            maxLength={500}
            disabled={creatingBusy}
            autoFocus
          />
          {formError ? (
            <p role="alert" className="text-xs text-destructive">
              {formError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setCreating(false);
                setFormError(null);
              }}
            >
              Annuler
            </Button>
            <Button
              type="submit"
              size="sm"
              loading={creatingBusy}
              disabled={name.trim().length === 0}
            >
              Créer la liste
            </Button>
          </div>
        </form>
      ) : null}

      <div className="border-b border-border p-2">
        <button
          type="button"
          onClick={onShowMyTasks}
          aria-pressed={showMyTasks}
          className={cn(
            "flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm font-medium transition-colors",
            showMyTasks
              ? "border-primary bg-accent text-accent-foreground"
              : "border-border bg-background hover:bg-muted",
          )}
        >
          <IconCheckSquare className="text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">Mes tâches</span>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-2" aria-label="Listes de tâches">
        {lists === null ? (
          error ? (
            <Alert tone="danger" className="flex flex-col items-start gap-2 text-xs">
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={() => void onRetry()}>
                Réessayer
              </Button>
            </Alert>
          ) : (
            <LoadingState className="py-4" label="Chargement des listes…" size={20} />
          )
        ) : lists.length === 0 ? (
          <EmptyState
            icon={<IconGrid />}
            title="Aucune liste pour le moment"
            hint="Créez-en une avec le bouton « Nouvelle liste » ci-dessus."
            className="gap-1 border-0 bg-transparent px-2 py-4 text-xs text-muted-foreground"
          />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {lists.map((list, index) => {
              const active = list.id === activeListId && !showMyTasks;
              return (
                <li
                  key={list.id}
                  className={cn(
                    "group flex items-center gap-1 rounded-md px-1 py-1",
                    active ? "bg-accent" : "hover:bg-muted",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelectList(list.id)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm",
                      active ? "text-accent-foreground" : "",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{list.name}</span>
                    {list.role !== "owner" ? (
                      <span className="text-[10px] uppercase text-muted-foreground">
                        {list.role === "viewer" ? "lecture" : "partagée"}
                      </span>
                    ) : null}
                  </button>

                  {list.canEdit ? (
                    <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="px-1.5"
                        disabled={index === 0 || movingId !== null}
                        aria-label={`Monter « ${list.name} »`}
                        title={`Monter « ${list.name} »`}
                        onClick={() => void move(list.id, -1)}
                      >
                        <span aria-hidden>↑</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="px-1.5"
                        disabled={index === lists.length - 1 || movingId !== null}
                        aria-label={`Descendre « ${list.name} »`}
                        title={`Descendre « ${list.name} »`}
                        onClick={() => void move(list.id, 1)}
                      >
                        <span aria-hidden>↓</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="px-1.5 text-[11px]"
                        aria-label={`Renommer « ${list.name} »`}
                        title={`Renommer « ${list.name} »`}
                        onClick={() => setRenameTarget(list)}
                      >
                        Renommer
                      </Button>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {renameTarget ? (
        <RenameListDialog
          key={renameTarget.id}
          list={renameTarget}
          onClose={() => setRenameTarget(null)}
          onRename={async (next) => {
            const ok = await onRenameList(renameTarget.id, next);
            if (ok) setAnnouncement(`Liste renommée en « ${next.trim()} ».`);
            return ok;
          }}
        />
      ) : null}
    </aside>
  );
}

function RenameListDialog({
  list,
  onClose,
  onRename,
}: {
  list: TaskListView;
  onClose: () => void;
  onRename: (name: string) => Promise<boolean>;
}) {
  // Monté avec une clé par liste : le champ part toujours de la valeur courante.
  const [name, setName] = useState(list.name);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = name.trim();
    if (clean.length === 0 || saving || clean === list.name) {
      onClose();
      return;
    }

    setSaving(true);
    setMessage(null);
    const ok = await onRename(clean);
    setSaving(false);
    if (ok) onClose();
    else setMessage("Renommage impossible. Vérifiez le nom et réessayez.");
  }

  return (
    <Dialog open={list !== null} onClose={onClose} title="Renommer la liste">
      <form onSubmit={onSubmit} method="post" className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="rename-list">Nom</Label>
          <Input
            id="rename-list"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={500}
            disabled={saving}
            autoFocus
          />
        </div>
        {message ? (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={saving} disabled={name.trim().length === 0}>
            Renommer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
