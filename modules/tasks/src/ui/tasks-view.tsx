import {
  Alert,
  Button,
  ConfirmDialog,
  EmptyState,
  IconCheckSquare,
  IconGrid,
  Input,
  Label,
  LoadingState,
  Menu,
  PageHeader,
  SegmentedTabs,
  Toasts,
  useToasts,
} from "@workspace/ui";
import type { DragEvent, FormEvent, KeyboardEvent, ReactNode } from "react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canDragReorder,
  type DropEdge,
  describeMove,
  edgeFromOffset,
  edgeIds,
  moveIds,
  nudgeIds,
  targetIndexFromHover,
} from "../dnd.ts";
import { DEFAULT_CRITERIA, filterTasks, isFiltering, type TaskFilterCriteria } from "../filters.ts";
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
  reorderTasksFn,
  type TaskLabelView,
  type TaskListView,
  type TaskView,
  updateTaskFn,
  updateTaskLabelFn,
} from "../server.ts";
import type { SubtaskProgress } from "../subtasks.ts";
import { FilterBar } from "./filter-bar.tsx";
import { LabelsDialog } from "./labels-dialog.tsx";
import { ListsSidebar } from "./lists-sidebar.tsx";
import { ShareListDialog } from "./share-list-dialog.tsx";
import {
  LIST_GROUP_OPTIONS,
  MY_TASKS_GROUP_OPTIONS,
  SortBar,
  TaskSections,
} from "./sort-controls.tsx";
import { SubtasksEditor } from "./subtasks-editor.tsx";
import { TaskLabelsEditor } from "./task-labels-editor.tsx";
import { TaskRow } from "./task-row.tsx";

const MY_TASKS_WINDOWS: { id: MyTasksWindow; label: string }[] = [
  { id: "today", label: "Aujourd'hui" },
  { id: "week", label: "Cette semaine" },
  { id: "all", label: "Tout" },
];

/** Priorités proposées dans l'éditeur en place (texte = information principale). */
const PRIORITY_OPTIONS: { value: "low" | "medium" | "high"; label: string }[] = [
  { value: "low", label: "Basse" },
  { value: "medium", label: "Moyenne" },
  { value: "high", label: "Haute" },
];

export function TasksView() {
  const [lists, setLists] = useState<TaskListView[] | null>(null);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskView[] | null>(null);
  const [labels, setLabels] = useState<TaskLabelView[]>([]);
  const [members, setMembers] = useState<MemberView[]>([]);
  const [criteria, setCriteria] = useState<TaskFilterCriteria>(DEFAULT_CRITERIA);
  const [sort, setSort] = useState<TaskSortId>("manual");
  const [group, setGroup] = useState<TaskGroupId>("none");
  const { toasts, push, dismiss } = useToasts();
  const [listsError, setListsError] = useState<string | null>(null);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const tasksRequestRef = useRef(0);

  // Glisser-déposer (mission 5) — actif seulement en ordre manuel sans
  // regroupement ni filtre : ailleurs, la position n'a pas de sens visible.
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; edge: DropEdge } | null>(null);
  // Une sous-tâche touchée dans l'éditeur impose de relire la liste à la
  // fermeture : son statut peut avoir basculé (parente terminée ou rouverte).
  const subtasksDirtyRef = useRef(false);

  // Vue agrégée « Mes tâches » — simple bascule d'affichage, pas de route.
  const [showMyTasks, setShowMyTasks] = useState(false);
  /** Panneau des listes : ouvert par défaut, refermable, réouvert depuis l'en-tête. */
  const [sidebarOpen, setSidebarOpen] = useState(true);
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

  // L'ordre manuel (positions) n'est demandé au serveur que lorsque l'écran
  // affiche réellement l'ordre de la liste ; les autres tris réordonnent côté
  // client et n'ont pas besoin d'un aller-retour réseau.
  const taskOrder: "default" | "manual" = sort === "manual" ? "manual" : "default";

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

  const loadTasks = useCallback(async (listId: string, order: "default" | "manual") => {
    const requestId = ++tasksRequestRef.current;
    setTasksError(null);
    try {
      const rows = await listTasksFn({ data: { listId, order } });
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
    if (activeListId) void loadTasks(activeListId, taskOrder);
  }, [activeListId, loadTasks, taskOrder]);

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
    void loadTasks(activeListId, taskOrder);
  }, [activeListId, taskOrder, loadTasks]);

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
      await loadTasks(activeListId, taskOrder);
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
      await loadTasks(activeListId, taskOrder);
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
      if (activeListId) await loadTasks(activeListId, taskOrder);
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

  /** Ouvre l'édition en place d'une tâche (clic, Entrée ou frappe directe). */
  function startEditing(task: TaskView, initialTitle?: string) {
    setEditTarget(initialTitle === undefined ? { ...task } : { ...task, title: initialTitle });
  }

  /** Referme l'éditeur en place ; un changement de sous-tâche impose une relecture. */
  function closeEditor() {
    setEditTarget(null);
    if (subtasksDirtyRef.current) {
      subtasksDirtyRef.current = false;
      void refreshActiveView();
    }
  }

  async function saveEdit() {
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
      subtasksDirtyRef.current = false;
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
      subtasksDirtyRef.current = false;
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
  // Glisser-déposer (ordre manuel)
  // -------------------------------------------------------------------------

  const canReorder = useMemo(
    () => !showMyTasks && canDragReorder(sort, group) && !isFiltering(criteria),
    [showMyTasks, sort, group, criteria],
  );

  function resetDrag() {
    setDragTaskId(null);
    setDropTarget(null);
  }

  async function persistTaskOrder(movedId: string, taskIds: string[]) {
    if (!activeListId || !orderedTasks) return;
    const previous = tasks;
    const byId = new Map(orderedTasks.map((row) => [row.id, row]));
    const reordered = taskIds
      .map((id) => byId.get(id))
      .filter((row): row is TaskView => row !== undefined);
    setTasks(reordered);
    const movedTitle = byId.get(movedId)?.title ?? "";
    const index = taskIds.indexOf(movedId);
    setAnnouncement(describeMove({ title: movedTitle, index, total: taskIds.length }));
    try {
      await reorderTasksFn({ data: { listId: activeListId, taskIds } });
      await loadTasks(activeListId, "manual");
    } catch (caught) {
      setTasks(previous);
      push("danger", caught instanceof Error ? caught.message : "Réorganisation impossible.");
    } finally {
      resetDrag();
    }
  }

  function onDragStartTask(task: TaskView, event: DragEvent<HTMLButtonElement>) {
    setDragTaskId(task.id);
    setDropTarget(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
  }

  function onDragOverTask(task: TaskView, event: DragEvent<HTMLLIElement>) {
    if (dragTaskId === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (task.id === dragTaskId) {
      setDropTarget(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const edge = edgeFromOffset(event.clientY - rect.top, rect.height);
    setDropTarget((current) =>
      current && current.id === task.id && current.edge === edge ? current : { id: task.id, edge },
    );
  }

  function onDropTask(event: DragEvent<HTMLLIElement>) {
    event.preventDefault();
    const movedId = dragTaskId;
    const target = dropTarget;
    if (!movedId || !target || !orderedTasks) {
      resetDrag();
      return;
    }
    const ids = orderedTasks.map((row) => row.id);
    const from = ids.indexOf(movedId);
    const hoverIndex = ids.indexOf(target.id);
    const to = targetIndexFromHover(hoverIndex, target.edge, ids.length);
    if (from < 0 || to < 0) {
      resetDrag();
      return;
    }
    const next = moveIds(ids, from, to);
    if (!next || next.every((id, index) => id === ids[index])) {
      resetDrag();
      return;
    }
    void persistTaskOrder(movedId, next);
  }

  function onTaskHandleKeyDown(task: TaskView, event: KeyboardEvent<HTMLButtonElement>) {
    if (!orderedTasks) return;
    const ids = orderedTasks.map((row) => row.id);
    const from = ids.indexOf(task.id);
    if (from < 0) return;
    let next: string[] | null = null;
    if (event.key === "ArrowUp") next = nudgeIds(ids, from, -1);
    else if (event.key === "ArrowDown") next = nudgeIds(ids, from, 1);
    else if (event.key === "Home") next = edgeIds(ids, from, "first");
    else if (event.key === "End") next = edgeIds(ids, from, "last");
    else return;
    event.preventDefault();
    if (!next || next.every((id, index) => id === ids[index])) return;
    void persistTaskOrder(task.id, next);
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
   * Après une modification d'étiquette, l'éditeur en place encore ouvert est
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
    return filterTasks(tasks, criteria);
  }, [tasks, criteria]);

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

  /**
   * Édition en place : le descripteur pilote le titre DANS la ligne, l'éditeur
   * se déploie juste en dessous — jamais dans un panneau ni une fenêtre.
   */
  const editing: TaskAreaEditing | null = editTarget
    ? {
        id: editTarget.id,
        title: editTarget.title,
        onTitleChange: (title) =>
          setEditTarget((current) => (current ? { ...current, title } : current)),
        onCommit: () => void saveEdit(),
        onCancel: closeEditor,
      }
    : null;

  const taskEditor = editTarget ? (
    <TaskEditorInline
      key={editTarget.id}
      task={editTarget}
      labels={labels}
      members={members}
      saving={savingEdit}
      onPatch={(patch) =>
        setEditTarget((current) => (current ? { ...current, ...patch } : current))
      }
      onCancel={closeEditor}
      onSubmit={() => void saveEdit()}
      onRequestDelete={() => setConfirmDeleteTask(true)}
      onToggleLabel={(labelId, checked) =>
        setEditTarget((current) => {
          if (!current) return current;
          const kept = current.labels.filter((label) => label.id !== labelId);
          if (!checked) return { ...current, labels: kept };
          const added = labels.find((label) => label.id === labelId);
          // L'étiquette peut avoir été supprimée entre-temps : on ignore.
          return added ? { ...current, labels: [...kept, added] } : current;
        })
      }
      onCreateLabel={onCreateLabel}
      onError={(message) => push("danger", message)}
      onSubtaskProgress={(progress) => {
        subtasksDirtyRef.current = true;
        setEditTarget((current) => {
          if (!current) return current;
          const status =
            progress.complete && current.status !== "done"
              ? "done"
              : !progress.complete && current.status === "done"
                ? "todo"
                : current.status;
          return {
            ...current,
            subtaskDone: progress.done,
            subtaskTotal: progress.total,
            status,
          };
        });
      }}
    />
  ) : null;

  return (
    <div className="tasks-view flex h-full min-h-0 flex-col gap-4 p-4 md:p-6">
      <PageHeader
        title="Tâches"
        actions={
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={sidebarOpen}
            aria-controls={sidebarOpen ? "lists-sidebar" : undefined}
            title={sidebarOpen ? "Masquer les listes" : "Afficher les listes"}
            onClick={() => setSidebarOpen((open) => !open)}
          >
            Listes
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1 gap-4">
        {sidebarOpen ? (
          <ListsSidebar
            lists={lists}
            error={listsError}
            activeListId={activeListId}
            showMyTasks={showMyTasks}
            onSelectList={(listId) => {
              setActiveListId(listId);
              setCriteria(DEFAULT_CRITERIA);
              setShowMyTasks(false);
              setDragTaskId(null);
              setDropTarget(null);
              setAnnouncement(
                `Liste « ${lists?.find((list) => list.id === listId)?.name ?? ""} » ouverte.`,
              );
            }}
            onShowMyTasks={() => {
              setShowMyTasks(true);
              setAnnouncement("Vue Mes tâches ouverte.");
            }}
            onClose={() => setSidebarOpen(false)}
            onCreateList={(name) => onCreateList(name)}
            onRenameList={(listId, name) => onRenameList(listId, name)}
            onReorderLists={(listIds) => onReorderLists(listIds)}
            onRetry={() => loadWorkspace()}
          />
        ) : null}

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
              onOpen={(task) => startEditing(task)}
              onStartTyping={(task, initial) => startEditing(task, initial)}
              editing={editing}
              editor={taskEditor}
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
              <header className="flex items-center gap-2 border-b border-border px-3 py-2">
                <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{activeList.name}</h2>
                <Menu
                  label="Actions de la liste"
                  align="end"
                  triggerClassName="h-8 w-8 border-transparent bg-transparent px-0 hover:bg-muted focus-visible:ring-offset-0"
                  triggerIcon={<span aria-hidden>⋯</span>}
                  items={[
                    {
                      id: "share",
                      label: "Partager",
                      onSelect: () => setShareOpen(true),
                    },
                    {
                      id: "labels",
                      label: "Étiquettes",
                      onSelect: () => setLabelsOpen(true),
                    },
                    ...(activeList.isOwner
                      ? [
                          {
                            id: "delete-list",
                            label: "Supprimer la liste",
                            destructive: true,
                            separated: true,
                            onSelect: () => setConfirmDeleteList(true),
                          },
                        ]
                      : []),
                  ]}
                />
              </header>

              {/* Barre d'outils unique : ajout rapide, filtres et tri en une rangée. */}
              <div
                role="toolbar"
                aria-label="Filtres et tri des tâches"
                className="flex flex-nowrap items-center gap-1 overflow-x-auto border-b border-border px-2 py-1 [&>*]:shrink-0"
              >
                <form
                  onSubmit={onQuickAdd}
                  method="post"
                  aria-busy={creatingTask || undefined}
                  className="flex w-64 items-center gap-1.5 lg:w-80"
                >
                  <Input
                    aria-label="Ajouter une tâche"
                    placeholder="Ajouter une tâche puis Entrée…"
                    value={quickTitle}
                    onChange={(event) => setQuickTitle(event.target.value)}
                    disabled={creatingTask}
                    className={creatingTask ? "h-8 text-sm opacity-60" : "h-8 text-sm"}
                  />
                  {creatingTask ? (
                    <span
                      aria-hidden
                      className="size-4 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent"
                    />
                  ) : null}
                </form>

                <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />

                <FilterBar
                  criteria={criteria}
                  labels={labels}
                  shown={orderedTasks?.length ?? 0}
                  total={tasks?.length ?? 0}
                  onChange={(patch) => setCriteria((current) => ({ ...current, ...patch }))}
                  onReset={() => setCriteria(DEFAULT_CRITERIA)}
                />

                <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />

                <SortBar
                  sort={sort}
                  group={group}
                  groupOptions={LIST_GROUP_OPTIONS}
                  onSortChange={setSort}
                  onGroupChange={setGroup}
                />
              </div>

              <TaskArea
                tasks={orderedTasks}
                total={tasks?.length ?? 0}
                error={tasksError}
                onRetry={retryTasks}
                group={group}
                busyTaskIds={busyTaskIds}
                assigneeNameOf={(userId) => memberOf(userId)?.name}
                onToggle={(task) => void onToggleDone(task)}
                onOpen={(task) => startEditing(task)}
                onStartTyping={(task, initial) => startEditing(task, initial)}
                editing={editing}
                editor={taskEditor}
                emptyState={{
                  title:
                    tasks?.length === 0
                      ? "Aucune tâche dans cette liste."
                      : isFiltering(criteria)
                        ? "Aucune tâche ne correspond à ce filtre."
                        : "Aucune tâche dans cette liste.",
                  hint:
                    tasks?.length === 0 && !isFiltering(criteria)
                      ? "Ajoutez-en une ci-dessus."
                      : undefined,
                }}
                drag={
                  canReorder
                    ? {
                        enabled: true,
                        draggingId: dragTaskId,
                        dropTarget,
                        onDragStart: onDragStartTask,
                        onDragOver: onDragOverTask,
                        onDrop: (event: DragEvent<HTMLLIElement>) => {
                          void onDropTask(event);
                        },
                        onDragEnd: resetDrag,
                        onHandleKeyDown: onTaskHandleKeyDown,
                      }
                    : undefined
                }
              />
            </>
          )}
        </section>
      </div>

      <Toasts toasts={toasts} dismiss={dismiss} />

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

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
 * Glisser-déposer partagé par la zone : état global (identifiant en cours,
 * cible) et rappels liés à la tâche. La zone résout, ligne par ligne, le
 * `TaskRowDrag` que consomme `TaskRow`.
 */
type TaskAreaDrag = {
  enabled: boolean;
  draggingId: string | null;
  dropTarget: { id: string; edge: DropEdge } | null;
  onDragStart: (task: TaskView, event: DragEvent<HTMLButtonElement>) => void;
  onDragOver: (task: TaskView, event: DragEvent<HTMLLIElement>) => void;
  onDrop: (event: DragEvent<HTMLLIElement>) => void;
  onDragEnd: () => void;
  onHandleKeyDown: (task: TaskView, event: KeyboardEvent<HTMLButtonElement>) => void;
};

/**
 * Édition en place : un seul éditeur ouvert, rattaché à une tâche. Le titre
 * vit DANS la ligne ; ce descripteur ne porte que son état.
 */
type TaskAreaEditing = {
  id: string;
  title: string;
  onTitleChange: (title: string) => void;
  onCommit: () => void;
  onCancel: () => void;
};

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
  onStartTyping,
  editing,
  editor,
  emptyState,
  drag,
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
  /** Frappe directe : ouvre l'éditeur avec la lettre tapée comme titre. */
  onStartTyping?: (task: T, initial: string) => void;
  /** Édition en place : descripteur du titre et éditeur déployé sous la ligne. */
  editing?: TaskAreaEditing | null;
  editor?: ReactNode;
  emptyState: { title: string; hint?: string };
  /** Glisser-déposer (ordre manuel) ; absent, les lignes sont statiques. */
  drag?: TaskAreaDrag;
}) {
  const sections = useMemo(() => {
    if (tasks === null) return null;
    if (group === "none") return undefined;
    return groupTasks(tasks, group);
  }, [tasks, group]);

  const renderRow = (task: T): ReactNode => {
    const isEditing = editing?.id === task.id;
    return (
      <Fragment key={task.id}>
        <TaskRow
          task={task}
          subtitle={subtitleOf?.(task)}
          busy={busyTaskIds.has(task.id)}
          assigneeName={assigneeNameOf(task.assigneeId)}
          onToggle={() => onToggle(task)}
          onOpen={() => onOpen(task)}
          onStartTyping={onStartTyping ? (initial) => onStartTyping(task, initial) : undefined}
          editing={
            isEditing && editing
              ? {
                  title: editing.title,
                  onChange: editing.onTitleChange,
                  onCommit: editing.onCommit,
                  onCancel: editing.onCancel,
                }
              : undefined
          }
          drag={
            drag?.enabled && !isEditing
              ? {
                  enabled: true,
                  dragging: drag.draggingId === task.id,
                  dropEdge: drag.dropTarget?.id === task.id ? drag.dropTarget.edge : null,
                  onDragStart: (event) => drag.onDragStart(task, event),
                  onDragOver: (event) => drag.onDragOver(task, event),
                  onDrop: (event) => drag.onDrop(event),
                  onDragEnd: drag.onDragEnd,
                  onHandleKeyDown: (event) => drag.onHandleKeyDown(task, event),
                }
              : undefined
          }
        />
        {isEditing ? editor : null}
      </Fragment>
    );
  };

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
        <LoadingState className="p-4" label="Chargement des tâches…" size={20} />
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
  onStartTyping,
  editing,
  editor,
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
  onStartTyping: (task: TaskView, initial: string) => void;
  editing: TaskAreaEditing | null;
  editor: ReactNode;
}) {
  return (
    <>
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">Mes tâches</h2>
        {tasks ? (
          <span className="text-xs text-muted-foreground">
            {total} tâche{total > 1 ? "s" : ""}
          </span>
        ) : null}
      </header>

      <div className="flex flex-nowrap items-center gap-1 overflow-x-auto border-b border-border px-2 py-1 [&>*]:shrink-0">
        <SegmentedTabs
          items={MY_TASKS_WINDOWS}
          value={selectedWindow}
          onChange={onWindowChange}
          ariaLabel="Fenêtre"
        />

        <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />

        <SortBar
          sort={sort}
          group={group}
          groupOptions={MY_TASKS_GROUP_OPTIONS}
          onSortChange={onSortChange}
          onGroupChange={onGroupChange}
        />
      </div>

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
        onStartTyping={onStartTyping}
        editing={editing}
        editor={editor}
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

/**
 * Éditeur en place d'une tâche : déployé sous sa propre ligne (jamais un
 * panneau ni une fenêtre), il porte les réglages — notes, statut, priorité,
 * échéance, assignation, étiquettes, sous-tâches — et enregistre en un geste.
 * Le titre, lui, se modifie directement dans la ligne (`TaskRow`).
 */
function TaskEditorInline({
  task,
  labels,
  members,
  saving,
  onPatch,
  onSubmit,
  onCancel,
  onRequestDelete,
  onToggleLabel,
  onCreateLabel,
  onError,
  onSubtaskProgress,
}: {
  task: TaskView;
  labels: TaskLabelView[];
  members: MemberView[];
  saving: boolean;
  onPatch: (patch: Partial<TaskView>) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onRequestDelete: () => void;
  onToggleLabel: (labelId: string, checked: boolean) => void;
  onCreateLabel: (name: string, color: TaskLabelColor) => Promise<string | null>;
  onError: (message: string) => void;
  onSubtaskProgress: (progress: SubtaskProgress) => void;
}) {
  const rootRef = useRef<HTMLLIElement>(null);

  // L'éditeur est déjà visible d'un clic : au besoin, on amène sa fin à l'écran.
  useEffect(() => {
    rootRef.current?.scrollIntoView({ block: "nearest" });
  }, []);

  return (
    <li
      ref={rootRef}
      id={`task-editor-${task.id}`}
      className="border-b border-border/60 bg-muted/20 px-3 py-3"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        method="post"
        aria-label="Modifier la tâche"
        className="flex flex-col gap-3"
        onKeyDown={(event) => {
          // Échap sort de l'éditeur, quel que soit le champ (Échap dans un
          // select natif referme son menu ET annule : acceptable, la saisie
          // n'est jamais perdue par surprise).
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-status">Statut</Label>
            <select
              id="task-status"
              value={task.status}
              onChange={(event) => onPatch({ status: event.target.value })}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="todo">À faire</option>
              <option value="in_progress">En cours</option>
              <option value="done">Terminée</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-priority">Priorité</Label>
            <select
              id="task-priority"
              value={task.priority}
              onChange={(event) => onPatch({ priority: event.target.value })}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {PRIORITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-due">Échéance</Label>
            <Input
              id="task-due"
              type="date"
              value={toDateInputValue(task.dueAt)}
              onChange={(event) => onPatch({ dueAt: fromDateInputValue(event.target.value) })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-assignee">Assigné à</Label>
            <select
              id="task-assignee"
              value={task.assigneeId ?? ""}
              onChange={(event) =>
                onPatch({ assigneeId: event.target.value === "" ? null : event.target.value })
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

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="task-notes">Notes</Label>
          <textarea
            id="task-notes"
            value={task.notes ?? ""}
            onChange={(event) =>
              onPatch({ notes: event.target.value.length === 0 ? null : event.target.value })
            }
            rows={3}
            maxLength={5000}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <TaskLabelsEditor
          labels={labels}
          selectedIds={task.labels.map((label) => label.id)}
          busy={saving}
          onToggle={onToggleLabel}
          onCreate={onCreateLabel}
        />

        <SubtasksEditor taskId={task.id} onError={onError} onProgress={onSubtaskProgress} />

        <div className="flex items-center justify-between">
          <Button type="button" variant="destructive" size="sm" onClick={onRequestDelete}>
            Supprimer
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Annuler
            </Button>
            <Button type="submit" loading={saving}>
              Enregistrer
            </Button>
          </div>
        </div>
      </form>
    </li>
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
