import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  cn,
  Dialog,
  EmptyState,
  IconCheckSquare,
  IconGrid,
  Input,
  Label,
  PageHeader,
  Toasts,
  useToasts,
} from "@workspace/ui";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createTaskFn,
  createTaskListFn,
  deleteTaskFn,
  deleteTaskListFn,
  listMembersFn,
  listTaskListsFn,
  listTasksFn,
  type MemberView,
  renameTaskListFn,
  type TaskListView,
  type TaskView,
  updateTaskFn,
} from "../server.ts";
import { ShareListDialog } from "./share-list-dialog.tsx";

type Filter = "all" | "todo" | "in_progress" | "done" | "overdue";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Toutes" },
  { id: "todo", label: "À faire" },
  { id: "in_progress", label: "En cours" },
  { id: "done", label: "Terminées" },
  { id: "overdue", label: "En retard" },
];

const PRIORITY_LABELS: Record<string, string> = {
  low: "Basse",
  medium: "Moyenne",
  high: "Haute",
};

const STATUS_LABELS: Record<string, string> = {
  todo: "À faire",
  in_progress: "En cours",
  done: "Terminée",
};

function isOverdue(task: TaskView): boolean {
  return task.status !== "done" && task.dueAt !== null && new Date(task.dueAt) < new Date();
}

function formatDue(value: string): string {
  return new Date(value).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Date saisie (yyyy-mm-dd) → instant UTC à midi (évite les dérives de fuseau). */
function fromDateInputValue(value: string): string | null {
  if (!value) return null;
  return new Date(`${value}T12:00:00Z`).toISOString();
}

export function TasksView() {
  const [lists, setLists] = useState<TaskListView[] | null>(null);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskView[] | null>(null);
  const [members, setMembers] = useState<MemberView[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const { toasts, push, dismiss } = useToasts();
  const [listsError, setListsError] = useState<string | null>(null);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const tasksRequestRef = useRef(0);

  const [newListOpen, setNewListOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [creatingList, setCreatingList] = useState(false);

  const [quickTitle, setQuickTitle] = useState("");
  const [creatingTask, setCreatingTask] = useState(false);

  const [editTarget, setEditTarget] = useState<TaskView | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingList, setDeletingList] = useState(false);
  const [confirmDeleteTask, setConfirmDeleteTask] = useState(false);
  const [confirmDeleteList, setConfirmDeleteList] = useState(false);

  const activeList = useMemo(
    () => lists?.find((list) => list.id === activeListId) ?? null,
    [lists, activeListId],
  );

  const loadLists = useCallback(async () => {
    const rows = await listTaskListsFn();
    setLists(rows);
    setListsError(null);
    setActiveListId((current) => current ?? rows[0]?.id ?? null);
  }, []);

  const loadWorkspace = useCallback(async () => {
    setListsError(null);
    try {
      const [rows, memberRows] = await Promise.all([listTaskListsFn(), listMembersFn()]);
      setLists(rows);
      setMembers(memberRows);
      setActiveListId((current) => current ?? rows[0]?.id ?? null);
    } catch {
      setListsError("Impossible de charger vos listes.");
    }
  }, []);

  const loadTasks = useCallback(async (listId: string) => {
    const requestId = ++tasksRequestRef.current;
    setTasksError(null);
    try {
      const rows = await listTasksFn({ data: { listId } });
      if (tasksRequestRef.current !== requestId) return;
      setTasks(rows);
    } catch {
      if (tasksRequestRef.current !== requestId) return;
      setTasks(null);
      setTasksError("Impossible de charger les tâches.");
    }
  }, []);

  const retryTasks = useCallback(() => {
    if (activeListId) void loadTasks(activeListId);
  }, [activeListId, loadTasks]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    if (!activeListId) {
      tasksRequestRef.current += 1;
      setTasks([]);
      setTasksError(null);
      return;
    }
    void loadTasks(activeListId);
  }, [activeListId, loadTasks]);

  const memberOf = (userId: string | null): MemberView | undefined =>
    userId ? members.find((member) => member.userId === userId) : undefined;

  const visibleTasks = useMemo(() => {
    if (!tasks) return null;
    switch (filter) {
      case "todo":
        return tasks.filter((task) => task.status === "todo");
      case "in_progress":
        return tasks.filter((task) => task.status === "in_progress");
      case "done":
        return tasks.filter((task) => task.status === "done");
      case "overdue":
        return tasks.filter(isOverdue);
      default:
        return tasks;
    }
  }, [tasks, filter]);

  async function onCreateList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newListName.trim();
    if (name.length === 0) return;

    setCreatingList(true);
    try {
      const created = await createTaskListFn({ data: { name } });
      setNewListName("");
      setNewListOpen(false);
      await loadLists();
      setActiveListId(created.id);
    } catch {
      push("danger", "Création de liste impossible.");
    } finally {
      setCreatingList(false);
    }
  }

  async function onQuickAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeListId) return;
    const title = quickTitle.trim();
    if (title.length === 0) return;

    setCreatingTask(true);
    try {
      await createTaskFn({ data: { listId: activeListId, title } });
      setQuickTitle("");
      await loadTasks(activeListId);
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Création impossible.");
    } finally {
      setCreatingTask(false);
    }
  }

  async function onToggleDone(task: TaskView) {
    const next = task.status === "done" ? "todo" : "done";
    setTasks(
      (current) =>
        current?.map((row) => (row.id === task.id ? { ...row, status: next } : row)) ?? current,
    );
    try {
      await updateTaskFn({ data: { taskId: task.id, status: next } });
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Mise à jour impossible.");
    } finally {
      if (activeListId) await loadTasks(activeListId);
    }
  }

  async function onSaveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editTarget) return;

    setSavingEdit(true);
    try {
      await updateTaskFn({
        data: {
          taskId: editTarget.id,
          title: editTarget.title,
          notes: editTarget.notes,
          priority: editTarget.priority as "low" | "medium" | "high",
          status: editTarget.status as "todo" | "in_progress" | "done",
          dueAt: editTarget.dueAt,
          assigneeId: editTarget.assigneeId,
        },
      });
      setEditTarget(null);
      if (activeListId) await loadTasks(activeListId);
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Enregistrement impossible.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function onDeleteTask() {
    if (!editTarget) return;
    setSavingEdit(true);
    try {
      await deleteTaskFn({ data: { taskId: editTarget.id } });
      setConfirmDeleteTask(false);
      setEditTarget(null);
      if (activeListId) await loadTasks(activeListId);
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Suppression impossible.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function onDeleteList() {
    if (!activeList) return;
    setDeletingList(true);
    try {
      await deleteTaskListFn({ data: { listId: activeList.id } });
      setConfirmDeleteList(false);
      setActiveListId(null);
      await loadLists();
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Suppression impossible.");
    } finally {
      setDeletingList(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageHeader title="Tâches" />

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Listes */}
        <aside className="flex w-56 shrink-0 flex-col rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <h2 className="text-sm font-semibold">Listes</h2>
            <Button variant="ghost" size="sm" onClick={() => setNewListOpen(true)}>
              Nouvelle liste
            </Button>
          </div>
          <nav className="flex-1 overflow-y-auto p-2" aria-label="Listes de tâches">
            {lists === null ? (
              listsError ? (
                <Alert tone="danger" className="flex flex-col items-start gap-2 text-xs">
                  <span>{listsError}</span>
                  <Button variant="outline" size="sm" onClick={() => void loadWorkspace()}>
                    Réessayer
                  </Button>
                </Alert>
              ) : (
                <p className="px-2 text-xs text-muted-foreground">Chargement…</p>
              )
            ) : lists.length === 0 ? (
              <EmptyState
                icon={<IconGrid />}
                title="Aucune liste pour le moment"
                className="gap-1 border-0 bg-transparent px-2 py-4 text-xs text-muted-foreground"
              />
            ) : (
              <ul className="flex flex-col gap-0.5">
                {lists.map((list) => (
                  <li key={list.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveListId(list.id);
                        setFilter("all");
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                        list.id === activeListId
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-muted",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{list.name}</span>
                      {list.role !== "owner" ? (
                        <span className="text-[10px] uppercase text-muted-foreground">
                          {list.role === "viewer" ? "lecture" : "partagée"}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>
        </aside>

        {/* Panneau de la liste active */}
        <section className="flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-card">
          {activeList === null ? (
            <EmptyState
              icon={<IconGrid />}
              title="Aucune liste sélectionnée"
              hint="Créez une liste pour organiser vos tâches — personnelles ou partagées avec votre organisation."
              action={
                <Button size="sm" onClick={() => setNewListOpen(true)}>
                  Nouvelle liste
                </Button>
              }
              className="flex-1 justify-center border-0 bg-transparent"
            />
          ) : (
            <>
              <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{activeList.name}</h2>
                <Button variant="ghost" size="sm" onClick={() => setShareOpen(true)}>
                  Partager
                </Button>
                <RenameListButton
                  list={activeList}
                  onRenamed={loadLists}
                  onError={(message) => push("danger", message)}
                />
                {activeList.isOwner ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => setConfirmDeleteList(true)}
                  >
                    Supprimer la liste
                  </Button>
                ) : null}
              </header>

              <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2">
                {FILTERS.map((item) => (
                  <Button
                    key={item.id}
                    variant={filter === item.id ? "secondary" : "ghost"}
                    size="sm"
                    aria-pressed={filter === item.id}
                    onClick={() => setFilter(item.id)}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>

              <form
                onSubmit={onQuickAdd}
                method="post"
                aria-busy={creatingTask || undefined}
                className="flex items-center gap-2 border-b border-border px-3 py-2"
              >
                <Input
                  aria-label="Ajouter une tâche"
                  placeholder="Ajouter une tâche puis Entrée…"
                  value={quickTitle}
                  onChange={(event) => setQuickTitle(event.target.value)}
                  disabled={creatingTask}
                  className={cn(creatingTask && "opacity-60")}
                />
                {creatingTask ? (
                  <span
                    aria-hidden
                    className="size-4 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent"
                  />
                ) : null}
              </form>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {tasksError ? (
                  <div className="p-4">
                    <Alert tone="danger" className="flex flex-col items-start gap-2">
                      <span>{tasksError}</span>
                      <Button variant="outline" size="sm" onClick={retryTasks}>
                        Réessayer
                      </Button>
                    </Alert>
                  </div>
                ) : visibleTasks === null ? (
                  <p className="p-4 text-sm text-muted-foreground">Chargement…</p>
                ) : visibleTasks.length === 0 ? (
                  <div className="p-4">
                    <EmptyState
                      icon={<IconCheckSquare />}
                      title={
                        filter === "all"
                          ? "Aucune tâche dans cette liste."
                          : "Aucune tâche ne correspond à ce filtre."
                      }
                      hint={filter === "all" ? "Ajoutez-en une ci-dessus." : undefined}
                      className="border-0 bg-transparent p-0"
                    />
                  </div>
                ) : (
                  <ul className="flex flex-col">
                    {visibleTasks.map((task) => {
                      const assignee = memberOf(task.assigneeId);
                      const overdue = isOverdue(task);
                      return (
                        <li
                          key={task.id}
                          className="flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0 hover:bg-muted/30"
                        >
                          <input
                            type="checkbox"
                            className="accent-primary"
                            checked={task.status === "done"}
                            aria-label={
                              task.status === "done"
                                ? `Réouvrir « ${task.title} »`
                                : `Marquer « ${task.title} » terminée`
                            }
                            onChange={() => void onToggleDone(task)}
                          />
                          <button
                            type="button"
                            onClick={() => setEditTarget({ ...task })}
                            className="min-w-0 flex-1 text-left"
                          >
                            <span
                              className={cn(
                                "block truncate text-sm",
                                task.status === "done" && "text-muted-foreground line-through",
                              )}
                            >
                              {task.title}
                            </span>
                          </button>

                          {task.status === "in_progress" ? (
                            <Badge variant="accent">En cours</Badge>
                          ) : null}

                          <span
                            role="img"
                            aria-label={`Priorité ${PRIORITY_LABELS[task.priority] ?? task.priority}`}
                            title={`Priorité ${PRIORITY_LABELS[task.priority] ?? task.priority}`}
                            className="flex shrink-0 items-center gap-1"
                          >
                            <span
                              aria-hidden
                              className={cn(
                                "size-2 shrink-0 rounded-full",
                                task.priority === "high"
                                  ? "bg-destructive"
                                  : task.priority === "medium"
                                    ? "bg-primary"
                                    : "bg-muted-foreground",
                              )}
                            />
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              {PRIORITY_LABELS[task.priority] ?? task.priority}
                            </span>
                          </span>

                          {task.dueAt ? (
                            <span
                              className={cn(
                                "shrink-0 text-xs",
                                overdue ? "font-medium text-destructive" : "text-muted-foreground",
                              )}
                            >
                              {formatDue(task.dueAt)}
                            </span>
                          ) : null}

                          {assignee ? (
                            <span
                              title={`Assignée à ${assignee.name}`}
                              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground"
                            >
                              {assignee.name.slice(0, 1).toUpperCase()}
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <Toasts toasts={toasts} dismiss={dismiss} />

      <Dialog open={newListOpen} onClose={() => setNewListOpen(false)} title="Nouvelle liste">
        <form onSubmit={onCreateList} method="post" className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="list-name">Nom de la liste</Label>
            <Input
              id="list-name"
              value={newListName}
              onChange={(event) => setNewListName(event.target.value)}
              placeholder="Projet 2026"
              maxLength={500}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setNewListOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" loading={creatingList} disabled={newListName.trim().length === 0}>
              Créer la liste
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        title="Modifier la tâche"
        className="max-w-lg"
      >
        {editTarget ? (
          <form onSubmit={onSaveEdit} method="post" className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="task-title">Titre</Label>
              <Input
                id="task-title"
                value={editTarget.title}
                onChange={(event) => setEditTarget({ ...editTarget, title: event.target.value })}
                maxLength={500}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="task-notes">Notes</Label>
              <textarea
                id="task-notes"
                value={editTarget.notes ?? ""}
                onChange={(event) =>
                  setEditTarget({
                    ...editTarget,
                    notes: event.target.value.length === 0 ? null : event.target.value,
                  })
                }
                rows={4}
                maxLength={5000}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="task-status">Statut</Label>
                <select
                  id="task-status"
                  value={editTarget.status}
                  onChange={(event) => setEditTarget({ ...editTarget, status: event.target.value })}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="todo">À faire</option>
                  <option value="in_progress">En cours</option>
                  <option value="done">Terminée</option>
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="task-priority">Priorité</Label>
                <select
                  id="task-priority"
                  value={editTarget.priority}
                  onChange={(event) =>
                    setEditTarget({ ...editTarget, priority: event.target.value })
                  }
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="low">Basse</option>
                  <option value="medium">Moyenne</option>
                  <option value="high">Haute</option>
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="task-due">Échéance</Label>
                <Input
                  id="task-due"
                  type="date"
                  value={toDateInputValue(editTarget.dueAt)}
                  onChange={(event) =>
                    setEditTarget({
                      ...editTarget,
                      dueAt: fromDateInputValue(event.target.value),
                    })
                  }
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="task-assignee">Assigné à</Label>
                <select
                  id="task-assignee"
                  value={editTarget.assigneeId ?? ""}
                  onChange={(event) =>
                    setEditTarget({
                      ...editTarget,
                      assigneeId: event.target.value === "" ? null : event.target.value,
                    })
                  }
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Personne</option>
                  {members.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => setConfirmDeleteTask(true)}
              >
                Supprimer
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => setEditTarget(null)}>
                  Annuler
                </Button>
                <Button type="submit" loading={savingEdit}>
                  Enregistrer
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {editTarget.status === "done"
                ? "Terminée"
                : `Statut : ${STATUS_LABELS[editTarget.status] ?? editTarget.status}`}
            </p>
          </form>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={confirmDeleteTask}
        onClose={() => setConfirmDeleteTask(false)}
        onConfirm={() => void onDeleteTask()}
        title="Supprimer la tâche ?"
        message={
          editTarget
            ? `« ${editTarget.title} » sera définitivement supprimée.`
            : "Cette tâche sera définitivement supprimée."
        }
        confirmLabel="Supprimer"
        busy={savingEdit}
        destructive
      />

      <ConfirmDialog
        open={confirmDeleteList}
        onClose={() => setConfirmDeleteList(false)}
        onConfirm={() => void onDeleteList()}
        title="Supprimer la liste et toutes ses tâches ?"
        message={
          activeList
            ? `« ${activeList.name} » et toutes ses tâches seront définitivement supprimées.`
            : "Cette liste et toutes ses tâches seront définitivement supprimées."
        }
        confirmLabel="Supprimer la liste"
        busy={deletingList}
        destructive
      />

      <ShareListDialog
        list={activeList}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        onShared={loadLists}
      />
    </div>
  );
}

function RenameListButton({
  list,
  onRenamed,
  onError,
}: {
  list: TaskListView;
  onRenamed: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(list.name);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = name.trim();
    if (clean.length === 0 || clean === list.name) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      await renameTaskListFn({ data: { listId: list.id, name: clean } });
      setOpen(false);
      await onRenamed();
    } catch {
      onError("Renommage impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setName(list.name);
          setOpen(true);
        }}
      >
        Renommer
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Renommer la liste">
        <form onSubmit={onSubmit} method="post" className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="rename-list">Nom</Label>
            <Input
              id="rename-list"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={500}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" loading={saving} disabled={name.trim().length === 0}>
              Renommer
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
