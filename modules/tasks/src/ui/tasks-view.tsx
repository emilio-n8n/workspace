import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  IconCheckSquare,
  IconGrid,
  Input,
  Label,
  PageHeader,
  SegmentedTabs,
  Toasts,
  useToasts,
} from "@workspace/ui";
import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  describeView,
  groupTasks,
  sortTasks,
  type TaskGroupId,
  type TaskSortId,
} from "../organize.ts";
import type { TaskLabelColor } from "../schema.ts";
import {
  createTaskFn,
  createTaskLabelFn,
  createTaskListFn,
  deleteTaskFn,
  deleteTaskLabelFn,
  deleteTaskListFn,
  listMembersFn,
  listMyTasksFn,
  listTaskLabelsFn,
  listTaskListsFn,
  listTasksFn,
  type MemberView,
  type MyTasksWindow,
  type MyTaskView,
  renameTaskListFn,
  reorderTaskListsFn,
  type TaskLabelView,
  type TaskListView,
  type TaskView,
  updateTaskFn,
  updateTaskLabelFn,
} from "../server.ts";
import { LabelsDialog } from "./labels-dialog.tsx";
import { ListsSidebar } from "./lists-sidebar.tsx";
import { ShareListDialog } from "./share-list-dialog.tsx";
import {
  LIST_GROUP_OPTIONS,
  MY_TASKS_GROUP_OPTIONS,
  SortBar,
  TaskSections,
} from "./sort-controls.tsx";
import { TaskLabelsEditor } from "./task-labels-editor.tsx";
import { isOverdue, TaskRow } from "./task-row.tsx";

type Filter = "all" | "todo" | "in_progress" | "done" | "overdue";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Toutes" },
  { id: "todo", label: "À faire" },
  { id: "in_progress", label: "En cours" },
  { id: "done", label: "Terminées" },
  { id: "overdue", label: "En retard" },
];

const MY_TASKS_WINDOWS: { id: MyTasksWindow; label: string }[] = [
  { id: "today", label: "Aujourd'hui" },
  { id: "week", label: "Cette semaine" },
  { id: "all", label: "Tout" },
];

/** Priorités proposées dans le dialogue d'édition (texte = information principale). */
const PRIORITY_OPTIONS: { value: "low" | "medium" | "high"; label: string }[] = [
  { value: "low", label: "Basse" },
  { value: "medium", label: "Moyenne" },
  { value: "high", label: "Haute" },
];

const STATUS_LABELS: Record<string, string> = {
  todo: "À faire",
  in_progress: "En cours",
  done: "Terminée",
};

export function TasksView() {
  const [lists, setLists] = useState<TaskListView[] | null>(null);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskView[] | null>(null);
  const [labels, setLabels] = useState<TaskLabelView[]>([]);
  const [members, setMembers] = useState<MemberView[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<TaskSortId>("manual");
  const [group, setGroup] = useState<TaskGroupId>("none");
  const { toasts, push, dismiss } = useToasts();
  const [listsError, setListsError] = useState<string | null>(null);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const tasksRequestRef = useRef(0);

  // Vue agrégée « Mes tâches » — simple bascule d'affichage, pas de route.
  const [showMyTasks, setShowMyTasks] = useState(false);
  const [myTasksWindow, setMyTasksWindow] = useState<MyTasksWindow>("today");
  const [myTasks, setMyTasks] = useState<MyTaskView[] | null>(null);
  const [myTasksError, setMyTasksError] = useState<string | null>(null);
  const [mySort, setMySort] = useState<TaskSortId>("due");
  const [myGroup, setMyGroup] = useState<TaskGroupId>("due");
  const [announcement, setAnnouncement] = useState("");
  const [busyTaskIds, setBusyTaskIds] = useState<ReadonlySet<string>>(new Set());
  const myTasksRequestRef = useRef(0);

  const [quickTitle, setQuickTitle] = useState("");
  const [creatingTask, setCreatingTask] = useState(false);

  const [editTarget, setEditTarget] = useState<TaskView | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
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
      const [rows, memberRows, labelRows] = await Promise.all([
        listTaskListsFn(),
        listMembersFn(),
        listTaskLabelsFn(),
      ]);
      setLists(rows);
      setMembers(memberRows);
      setLabels(labelRows);
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

  const loadMyTasks = useCallback(async (window: MyTasksWindow) => {
    const requestId = ++myTasksRequestRef.current;
    setMyTasksError(null);
    try {
      const rows = await listMyTasksFn({ data: { window } });
      if (myTasksRequestRef.current !== requestId) return;
      setMyTasks(rows);
    } catch {
      if (myTasksRequestRef.current !== requestId) return;
      setMyTasks(null);
      setMyTasksError("Impossible de charger vos tâches.");
    }
  }, []);

  const retryTasks = useCallback(() => {
    if (activeListId) void loadTasks(activeListId);
  }, [activeListId, loadTasks]);

  const retryMyTasks = useCallback(() => {
    void loadMyTasks(myTasksWindow);
  }, [loadMyTasks, myTasksWindow]);

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

  useEffect(() => {
    if (!showMyTasks) return;
    void loadMyTasks(myTasksWindow);
  }, [showMyTasks, myTasksWindow, loadMyTasks]);

  const memberOf = (userId: string | null): MemberView | undefined =>
    userId ? members.find((member) => member.userId === userId) : undefined;

  function markTaskBusy(taskId: string, busy: boolean) {
    setBusyTaskIds((current) => {
      const next = new Set(current);
      if (busy) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  }

  /** Rafraîchit la vue affichée (liste active ou agrégat « Mes tâches »). */
  async function refreshActiveView() {
    if (showMyTasks) {
      await loadMyTasks(myTasksWindow);
    } else if (activeListId) {
      await loadTasks(activeListId);
    }
  }

  // -------------------------------------------------------------------------
  // Listes : créer, renommer, ordonner
  // -------------------------------------------------------------------------

  async function onCreateList(name: string): Promise<boolean> {
    try {
      const created = await createTaskListFn({ data: { name } });
      const rows = await listTaskListsFn();
      setLists(rows);
      setListsError(null);
      setActiveListId(created.id);
      return true;
    } catch {
      push("danger", "Création de liste impossible.");
      return false;
    }
  }

  async function onRenameList(listId: string, name: string): Promise<boolean> {
    try {
      await renameTaskListFn({ data: { listId, name } });
      await loadLists();
      return true;
    } catch {
      push("danger", "Renommage impossible.");
      return false;
    }
  }

  /**
   * Réorganisation optimiste : l'ordre bouge tout de suite, le serveur confirme.
   * En cas d'échec on revient à l'ordre reçu et on le signale.
   */
  async function onReorderLists(listIds: string[]): Promise<boolean> {
    const previous = lists;
    const reordered = listIds
      .map((listId) => previous?.find((list) => list.id === listId))
      .filter((list): list is TaskListView => list !== undefined);
    setLists(reordered);
    try {
      // Le serveur fait autorité sur l'ordre renvoyé (il valide l'ensemble).
      setLists(await reorderTaskListsFn({ data: { listIds } }));
      return true;
    } catch {
      setLists(previous);
      push("danger", "Réorganisation impossible.");
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Tâches
  // -------------------------------------------------------------------------

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
      setAnnouncement(`Tâche « ${title} » ajoutée.`);
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Création impossible.");
    } finally {
      setCreatingTask(false);
    }
  }

  async function onToggleDone(task: TaskView) {
    const next = task.status === "done" ? "todo" : "done";
    markTaskBusy(task.id, true);
    setTasks(
      (current) =>
        current?.map((row) => (row.id === task.id ? { ...row, status: next } : row)) ?? current,
    );
    setAnnouncement(
      next === "done"
        ? `Tâche « ${task.title} » terminée.`
        : `Tâche « ${task.title} » remise à faire.`,
    );
    try {
      await updateTaskFn({ data: { taskId: task.id, status: next } });
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Mise à jour impossible.");
    } finally {
      markTaskBusy(task.id, false);
      if (activeListId) await loadTasks(activeListId);
    }
  }

  /** Terminer depuis « Mes tâches » : la tâche quitte l'agrégat après rechargement. */
  async function onToggleMyTask(task: TaskView) {
    markTaskBusy(task.id, true);
    setAnnouncement(`Tâche « ${task.title} » terminée.`);
    try {
      await updateTaskFn({ data: { taskId: task.id, status: "done" } });
      await loadMyTasks(myTasksWindow);
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Mise à jour impossible.");
    } finally {
      markTaskBusy(task.id, false);
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
          labelIds: editTarget.labels.map((label) => label.id),
        },
      });
      setEditTarget(null);
      setAnnouncement("Tâche enregistrée.");
      await refreshActiveView();
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Enregistrement impossible.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function onDeleteTask() {
    if (!editTarget) return;
    const title = editTarget.title;
    setSavingEdit(true);
    try {
      await deleteTaskFn({ data: { taskId: editTarget.id } });
      setConfirmDeleteTask(false);
      setEditTarget(null);
      setAnnouncement(`Tâche « ${title} » supprimée.`);
      await refreshActiveView();
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Suppression impossible.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function onDeleteList() {
    if (!activeList) return;
    const name = activeList.name;
    setDeletingList(true);
    try {
      await deleteTaskListFn({ data: { listId: activeList.id } });
      setConfirmDeleteList(false);
      setActiveListId(null);
      await loadLists();
      setAnnouncement(`Liste « ${name} » supprimée.`);
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Suppression impossible.");
    } finally {
      setDeletingList(false);
    }
  }

  // -------------------------------------------------------------------------
  // Étiquettes d'organisation
  // -------------------------------------------------------------------------

  async function onCreateLabel(name: string, color: TaskLabelColor): Promise<string | null> {
    try {
      const created = await createTaskLabelFn({ data: { name, color } });
      const rows = await listTaskLabelsFn();
      setLabels(rows);
      alignEditTargetLabels(rows);
      return created.id;
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Création impossible.");
      return null;
    }
  }

  /**
   * Après une modification d'étiquette, le dialogue d'édition encore ouvert est
   * réaligné : sans cela, sa liste de cases étiquetées afficherait un nom ou une
   * couleur périmée, et l'enregistrement enverrait un identifiant disparu.
   */
  function alignEditTargetLabels(next: TaskLabelView[]) {
    setEditTarget((current) => {
      if (!current) return current;
      const byId = new Map(next.map((label) => [label.id, label]));
      return {
        ...current,
        labels: current.labels
          .map((label) => byId.get(label.id))
          .filter((label): label is TaskLabelView => label !== undefined),
      };
    });
  }

  async function onUpdateLabel(
    labelId: string,
    patch: { name?: string; color?: string },
  ): Promise<boolean> {
    try {
      await updateTaskLabelFn({ data: { labelId, ...patch } });
      const rows = await listTaskLabelsFn();
      setLabels(rows);
      alignEditTargetLabels(rows);
      return true;
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Mise à jour impossible.");
      return false;
    }
  }

  async function onDeleteLabel(labelId: string): Promise<boolean> {
    try {
      await deleteTaskLabelFn({ data: { labelId } });
      const rows = await listTaskLabelsFn();
      setLabels(rows);
      alignEditTargetLabels(rows);
      return true;
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Suppression impossible.");
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Rendu
  // -------------------------------------------------------------------------

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

  const orderedTasks = useMemo(
    () => (visibleTasks === null ? null : sortTasks(visibleTasks, sort)),
    [visibleTasks, sort],
  );

  useEffect(() => {
    if (orderedTasks === null) return;
    setAnnouncement(
      describeView({ total: tasks?.length ?? 0, shown: orderedTasks.length, sort, group }),
    );
  }, [orderedTasks, sort, group, tasks]);

  const orderedMyTasks = useMemo(
    () => (myTasks === null ? null : sortTasks(myTasks, mySort)),
    [myTasks, mySort],
  );

  useEffect(() => {
    if (!showMyTasks || orderedMyTasks === null) return;
    setAnnouncement(
      describeView({
        total: myTasks?.length ?? 0,
        shown: orderedMyTasks.length,
        sort: mySort,
        group: myGroup,
      }),
    );
  }, [showMyTasks, orderedMyTasks, mySort, myGroup, myTasks]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageHeader title="Tâches" />

      <div className="flex min-h-0 flex-1 gap-4">
        <ListsSidebar
          lists={lists}
          error={listsError}
          activeListId={activeListId}
          showMyTasks={showMyTasks}
          onSelectList={(listId) => {
            setActiveListId(listId);
            setFilter("all");
            setShowMyTasks(false);
            setAnnouncement(
              `Liste « ${lists?.find((list) => list.id === listId)?.name ?? ""} » ouverte.`,
            );
          }}
          onShowMyTasks={() => {
            setShowMyTasks(true);
            setAnnouncement("Vue Mes tâches ouverte.");
          }}
          onCreateList={(name) => onCreateList(name)}
          onRenameList={(listId, name) => onRenameList(listId, name)}
          onReorderLists={(listIds) => onReorderLists(listIds)}
          onRetry={() => loadWorkspace()}
        />

        <section className="flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-card">
          {showMyTasks ? (
            <MyTasksPanel
              tasks={orderedMyTasks}
              total={myTasks?.length ?? 0}
              error={myTasksError}
              window={myTasksWindow}
              onWindowChange={setMyTasksWindow}
              onRetry={retryMyTasks}
              sort={mySort}
              group={myGroup}
              onSortChange={setMySort}
              onGroupChange={setMyGroup}
              busyTaskIds={busyTaskIds}
              assigneeNameOf={(userId) => memberOf(userId)?.name}
              onToggle={(task) => void onToggleMyTask(task)}
              onOpen={(task) => setEditTarget({ ...task })}
            />
          ) : activeList === null ? (
            <EmptyState
              icon={<IconGrid />}
              title="Aucune liste sélectionnée"
              hint="Créez une liste dans le panneau de gauche pour organiser vos tâches — personnelles ou partagées avec votre organisation."
              className="flex-1 justify-center border-0 bg-transparent"
            />
          ) : (
            <>
              <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{activeList.name}</h2>
                <Button variant="ghost" size="sm" onClick={() => setShareOpen(true)}>
                  Partager
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setLabelsOpen(true)}>
                  Étiquettes
                </Button>
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
                  className={creatingTask ? "opacity-60" : undefined}
                />
                {creatingTask ? (
                  <span
                    aria-hidden
                    className="size-4 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent"
                  />
                ) : null}
              </form>

              <SortBar
                sort={sort}
                group={group}
                groupOptions={LIST_GROUP_OPTIONS}
                onSortChange={setSort}
                onGroupChange={setGroup}
              />

              <TaskArea
                tasks={orderedTasks}
                total={tasks?.length ?? 0}
                error={tasksError}
                onRetry={retryTasks}
                group={group}
                busyTaskIds={busyTaskIds}
                assigneeNameOf={(userId) => memberOf(userId)?.name}
                onToggle={(task) => void onToggleDone(task)}
                onOpen={(task) => setEditTarget({ ...task })}
                emptyState={{
                  title:
                    filter === "all"
                      ? "Aucune tâche dans cette liste."
                      : "Aucune tâche ne correspond à ce filtre.",
                  hint: filter === "all" ? "Ajoutez-en une ci-dessus." : undefined,
                }}
              />
            </>
          )}
        </section>
      </div>

      <Toasts toasts={toasts} dismiss={dismiss} />

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

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
                  {PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
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

            <TaskLabelsEditor
              labels={labels}
              selectedIds={editTarget.labels.map((label) => label.id)}
              busy={savingEdit}
              onToggle={(labelId, checked) =>
                setEditTarget((current) => {
                  if (!current) return current;
                  const kept = current.labels.filter((label) => label.id !== labelId);
                  if (!checked) return { ...current, labels: kept };
                  const added = labels.find((label) => label.id === labelId);
                  // L'étiquette peut avoir été supprimée entre-temps : on ignore.
                  return added ? { ...current, labels: [...kept, added] } : current;
                })
              }
              onCreate={onCreateLabel}
            />

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

      <LabelsDialog
        labels={labels}
        open={labelsOpen}
        onClose={() => setLabelsOpen(false)}
        onCreate={onCreateLabel}
        onUpdate={onUpdateLabel}
        onDelete={onDeleteLabel}
      />
    </div>
  );
}

/**
 * Zone de tâches : chargement, erreur, vide, liste à plat ou sections de
 * regroupement. Partagée par la liste active et par l'agrégat « Mes tâches »,
 * pour que les deux écrans vieillissent ensemble.
 */
function TaskArea<T extends TaskView>({
  tasks,
  total,
  error,
  onRetry,
  group,
  busyTaskIds,
  assigneeNameOf,
  subtitleOf,
  onToggle,
  onOpen,
  emptyState,
}: {
  tasks: T[] | null;
  total: number;
  error: string | null;
  onRetry: () => void;
  group: TaskGroupId;
  busyTaskIds: ReadonlySet<string>;
  assigneeNameOf: (userId: string | null) => string | undefined;
  /** Sous-titre de ligne : le nom de la liste dans l'agrégat « Mes tâches ». */
  subtitleOf?: (task: T) => string | undefined;
  onToggle: (task: T) => void;
  onOpen: (task: T) => void;
  emptyState: { title: string; hint?: string };
}) {
  const sections = useMemo(() => {
    if (tasks === null) return null;
    if (group === "none") return undefined;
    return groupTasks(tasks, group);
  }, [tasks, group]);

  const renderRow = (task: T): ReactNode => (
    <TaskRow
      key={task.id}
      task={task}
      subtitle={subtitleOf?.(task)}
      busy={busyTaskIds.has(task.id)}
      assigneeName={assigneeNameOf(task.assigneeId)}
      onToggle={() => onToggle(task)}
      onOpen={() => onOpen(task)}
    />
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {error ? (
        <div className="p-4">
          <Alert tone="danger" className="flex flex-col items-start gap-2">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={onRetry}>
              Réessayer
            </Button>
          </Alert>
        </div>
      ) : tasks === null ? (
        <p className="p-4 text-sm text-muted-foreground">Chargement…</p>
      ) : tasks.length === 0 ? (
        <div className="p-4">
          <EmptyState
            icon={<IconCheckSquare />}
            title={emptyState.title}
            hint={emptyState.hint}
            className="border-0 bg-transparent p-0"
          />
        </div>
      ) : sections ? (
        <TaskSections groups={sections} renderRow={renderRow} />
      ) : (
        <ul className="flex flex-col">{tasks.map(renderRow)}</ul>
      )}
      {total > 0 && tasks && tasks.length < total ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          {tasks.length} tâche{tasks.length > 1 ? "s" : ""} sur {total} affichée
          {tasks.length > 1 ? "s" : ""}.
        </p>
      ) : null}
    </div>
  );
}

/** Agrégat « Mes tâches » : assignées à moi (ou sans assigné si j'ai l'écriture), toutes listes. */
function MyTasksPanel({
  tasks,
  total,
  error,
  window: selectedWindow,
  onWindowChange,
  onRetry,
  sort,
  group,
  onSortChange,
  onGroupChange,
  busyTaskIds,
  assigneeNameOf,
  onToggle,
  onOpen,
}: {
  tasks: MyTaskView[] | null;
  total: number;
  error: string | null;
  window: MyTasksWindow;
  onWindowChange: (window: MyTasksWindow) => void;
  onRetry: () => void;
  sort: TaskSortId;
  group: TaskGroupId;
  onSortChange: (sort: TaskSortId) => void;
  onGroupChange: (group: TaskGroupId) => void;
  busyTaskIds: ReadonlySet<string>;
  assigneeNameOf: (userId: string | null) => string | undefined;
  onToggle: (task: TaskView) => void;
  onOpen: (task: TaskView) => void;
}) {
  return (
    <>
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">Mes tâches</h2>
        {tasks ? (
          <span className="text-xs text-muted-foreground">
            {total} tâche{total > 1 ? "s" : ""}
          </span>
        ) : null}
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <SegmentedTabs
          items={MY_TASKS_WINDOWS}
          value={selectedWindow}
          onChange={onWindowChange}
          ariaLabel="Fenêtre"
        />
      </div>

      <SortBar
        sort={sort}
        group={group}
        groupOptions={MY_TASKS_GROUP_OPTIONS}
        onSortChange={onSortChange}
        onGroupChange={onGroupChange}
      />

      <TaskArea
        tasks={tasks}
        total={total}
        error={error}
        onRetry={onRetry}
        group={group}
        busyTaskIds={busyTaskIds}
        assigneeNameOf={assigneeNameOf}
        subtitleOf={(task) => task.listName}
        onToggle={onToggle}
        onOpen={onOpen}
        emptyState={{
          title: "Rien à faire — profitez-en.",
          hint:
            selectedWindow === "today"
              ? "Aucune échéance aujourd'hui. Regardez « Cette semaine » ou « Tout »."
              : selectedWindow === "week"
                ? "Aucune échéance cette semaine. Regardez « Tout »."
                : undefined,
        }}
      />
    </>
  );
}

/** Date saisie (yyyy-mm-dd) → instant UTC à midi (évite les dérives de fuseau). */
function fromDateInputValue(value: string): string | null {
  if (!value) return null;
  return new Date(`${value}T12:00:00Z`).toISOString();
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
