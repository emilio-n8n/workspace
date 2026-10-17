import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireActor } from "@workspace/auth";
import { schema as coreSchema, getDb, sortFr } from "@workspace/database";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  countSubtasks,
  createLabel,
  createList,
  createSubtask,
  createTask,
  deleteLabel,
  deleteList,
  deleteSubtask,
  deleteTask,
  listLabels,
  listListGrants,
  listLists,
  listMyTasks,
  listSubtasks,
  listTaskLabels,
  listTasks,
  type MyTaskEntry,
  renameList,
  reorderLists,
  reorderSubtasks,
  reorderTasks,
  type Subtask,
  shareList,
  type Task,
  type TaskLabel,
  unshareList,
  updateLabel,
  updateSubtask,
  updateTask,
} from "./index.ts";

export type { MyTasksWindow } from "./index.ts";

export type TaskListView = {
  id: string;
  name: string;
  role: string;
  isOwner: boolean;
  canEdit: boolean;
  position: number;
};
export type TaskView = {
  id: string;
  listId: string;
  title: string;
  notes: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  completedAt: string | null;
  assigneeId: string | null;
  updatedAt: string;
  createdAt: string;
  /** Ordre manuel persistant (glisser-déposer). */
  position: number;
  labels: TaskLabelView[];
  /** Sous-tâches : totaux pour la puce de progression (0 = aucune). */
  subtaskTotal: number;
  subtaskDone: number;
};
export type TaskLabelView = { id: string; name: string; color: string };
export type SubtaskView = {
  id: string;
  taskId: string;
  title: string;
  isDone: boolean;
  position: number;
};
export type MemberView = { userId: string; name: string; email: string };
export type ListGrantView = { id: string; subjectLabel: string; role: string };
export type MyTaskView = TaskView & { listName: string };

function toLabelView(label: TaskLabel): TaskLabelView {
  return { id: label.id, name: label.name, color: label.color };
}

function toSubtaskView(subtask: Subtask): SubtaskView {
  return {
    id: subtask.id,
    taskId: subtask.taskId,
    title: subtask.title,
    isDone: subtask.isDone,
    position: subtask.position,
  };
}

function toTaskView(
  task: Task & {
    labels?: readonly TaskLabel[];
    subtaskTotal?: number;
    subtaskDone?: number;
  },
): TaskView {
  return {
    id: task.id,
    listId: task.listId,
    title: task.title,
    notes: task.notes,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    assigneeId: task.assigneeId,
    updatedAt: task.updatedAt.toISOString(),
    createdAt: task.createdAt.toISOString(),
    position: task.position,
    labels: (task.labels ?? []).map(toLabelView),
    subtaskTotal: task.subtaskTotal ?? 0,
    subtaskDone: task.subtaskDone ?? 0,
  };
}

const listInput = z.object({ listId: z.string().uuid() });
const taskInput = z.object({ taskId: z.string().uuid() });

// ---------------------------------------------------------------------------
// Listes
// ---------------------------------------------------------------------------

export const listTaskListsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<TaskListView[]> => {
    const { actor } = await requireActor(getRequest().headers);
    const rows = await listLists(actor);
    return rows.map((row) => ({
      id: row.list.id,
      name: row.list.name,
      role: row.role,
      isOwner: row.role === "owner",
      canEdit: row.role === "owner" || row.role === "editor",
      position: row.list.position,
    }));
  },
);

const reorderInput = z.object({ listIds: z.array(z.string().uuid()).min(1) });

/** Réordonne le panneau des listes : l'ordre complet, dans sa nouvelle suite. */
export const reorderTaskListsFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => reorderInput.parse(input))
  .handler(async ({ data }): Promise<TaskListView[]> => {
    const { actor } = await requireActor(getRequest().headers);
    const rows = await reorderLists(actor, data.listIds);
    return rows.map((row) => ({
      id: row.list.id,
      name: row.list.name,
      role: row.role,
      isOwner: row.role === "owner",
      canEdit: row.role === "owner" || row.role === "editor",
      position: row.list.position,
    }));
  });

export const createTaskListFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ name: z.string().trim().min(1).max(500) }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    const list = await createList(actor, { name: data.name });
    return { id: list.id, name: list.name };
  });

export const renameTaskListFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ listId: z.string().uuid(), name: z.string().trim().min(1).max(500) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    const list = await renameList(actor, data.listId, data.name);
    return { id: list.id, name: list.name };
  });

export const deleteTaskListFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => listInput.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await deleteList(actor, data.listId);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Tâches
// ---------------------------------------------------------------------------

const listTasksInput = z.object({
  listId: z.string().uuid(),
  // « default » : non terminées d'abord puis échéance. « manual » : l'ordre
  // glissé, seul ordre dans lequel le glisser-déposer a un sens.
  order: z.enum(["default", "manual"]).optional(),
});

export const listTasksFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => listTasksInput.parse(input))
  .handler(async ({ data }): Promise<TaskView[]> => {
    const { actor } = await requireActor(getRequest().headers);
    const rows = await listTasks(actor, { listId: data.listId, order: data.order });
    return rows.map(toTaskView);
  });

/** Réordonne les tâches d'une liste (glisser-déposer ou clavier). */
export const reorderTasksFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({ listId: z.string().uuid(), taskIds: z.array(z.string().uuid()).min(1) })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await reorderTasks(actor, data.listId, data.taskIds);
    return { ok: true };
  });

const myTasksInput = z.object({
  window: z.enum(["today", "week", "all"]).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

/** Agrégat « Mes tâches » : tout ce qui est assigné (ou à prendre) toutes listes confondues. */
export const listMyTasksFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => myTasksInput.parse(input ?? {}))
  .handler(async ({ data }): Promise<MyTaskView[]> => {
    const { actor } = await requireActor(getRequest().headers);
    const rows: MyTaskEntry[] = await listMyTasks(actor, {
      window: data.window,
      limit: data.limit,
    });
    return rows.map((row) => ({ ...toTaskView(row.task), listName: row.listName }));
  });

export const createTaskFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        listId: z.string().uuid(),
        title: z.string().trim().min(1).max(500),
        priority: z.enum(["low", "medium", "high"]).optional(),
        dueAt: z.string().nullable().optional(),
        assigneeId: z.string().nullable().optional(),
        labelIds: z.array(z.string().uuid()).max(20).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    const task = await createTask(actor, {
      listId: data.listId,
      title: data.title,
      priority: data.priority,
      dueAt: data.dueAt,
      assigneeId: data.assigneeId,
      labelIds: data.labelIds,
    });
    // Les étiquettes sont relues par le chemin public : la vue renvoyée dit la
    // vérité de ce qui a bien été attaché.
    const labels = await listTaskLabels(actor, task.id);
    return toTaskView({ ...task, labels, subtaskTotal: 0, subtaskDone: 0 });
  });

export const updateTaskFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        taskId: z.string().uuid(),
        title: z.string().trim().min(1).max(500).optional(),
        notes: z.string().max(5000).nullable().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        status: z.enum(["todo", "in_progress", "done"]).optional(),
        dueAt: z.string().nullable().optional(),
        assigneeId: z.string().nullable().optional(),
        labelIds: z.array(z.string().uuid()).max(20).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    const { taskId, ...patch } = data;
    const task = await updateTask(actor, taskId, patch);
    const [labels, counters] = await Promise.all([
      listTaskLabels(actor, task.id),
      countSubtasks(actor, task.id),
    ]);
    return toTaskView({
      ...task,
      labels,
      subtaskTotal: counters.total,
      subtaskDone: counters.done,
    });
  });

export const deleteTaskFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => taskInput.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await deleteTask(actor, data.taskId);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Membres et partage
// ---------------------------------------------------------------------------

export const listMembersFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<MemberView[]> => {
    const { actor } = await requireActor(getRequest().headers);
    const db = getDb();
    const rows = await db
      .select({
        userId: coreSchema.user.id,
        name: coreSchema.user.name,
        email: coreSchema.user.email,
      })
      .from(coreSchema.member)
      .innerJoin(coreSchema.user, eq(coreSchema.member.userId, coreSchema.user.id))
      .where(eq(coreSchema.member.organizationId, actor.orgId))
      .orderBy(asc(coreSchema.user.name));
    return sortFr(rows, (row) => row.name);
  },
);

export const shareTaskListFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        listId: z.string().uuid(),
        userId: z.string().min(1),
        role: z.enum(["viewer", "commenter", "editor"]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await shareList(actor, data.listId, {
      subject: { kind: "user", id: data.userId },
      role: data.role,
    });
    return { ok: true };
  });

export const unshareTaskListFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ listId: z.string().uuid(), grantId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    const removed = await unshareList(actor, data.listId, data.grantId);
    return { removed };
  });

export const listTaskListGrantsFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => listInput.parse(input))
  .handler(async ({ data }): Promise<ListGrantView[]> => {
    const { actor } = await requireActor(getRequest().headers);
    const grants = await listListGrants(actor, data.listId);
    const db = getDb();

    const views: ListGrantView[] = [];
    for (const grant of grants) {
      let label = grant.subjectId;
      if (grant.subjectType === "user") {
        const [row] = await db
          .select({ name: coreSchema.user.name, email: coreSchema.user.email })
          .from(coreSchema.user)
          .where(eq(coreSchema.user.id, grant.subjectId))
          .limit(1);
        label = row ? `${row.name} (${row.email})` : grant.subjectId;
      } else if (grant.subjectType === "group") {
        label = "Équipe";
      } else {
        label = "Toute l'organisation";
      }
      views.push({ id: grant.id, subjectLabel: label, role: grant.role });
    }
    return views;
  });

// ---------------------------------------------------------------------------
// Étiquettes
// ---------------------------------------------------------------------------

const labelColors = ["green", "blue", "amber", "violet", "red", "slate"] as const;

/** Étiquettes de l'organisation (toutes listes confondues). */
export const listTaskLabelsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<TaskLabelView[]> => {
    const { actor } = await requireActor(getRequest().headers);
    const rows = await listLabels(actor);
    return rows.map(toLabelView);
  },
);

export const createTaskLabelFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(40),
        color: z.enum(labelColors).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<TaskLabelView> => {
    const { actor } = await requireActor(getRequest().headers);
    const label = await createLabel(actor, { name: data.name, color: data.color });
    return toLabelView(label);
  });

export const updateTaskLabelFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        labelId: z.string().uuid(),
        name: z.string().trim().min(1).max(40).optional(),
        color: z.enum(labelColors).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<TaskLabelView> => {
    const { actor } = await requireActor(getRequest().headers);
    const label = await updateLabel(actor, data.labelId, {
      name: data.name,
      color: data.color,
    });
    return toLabelView(label);
  });

export const deleteTaskLabelFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ labelId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await deleteLabel(actor, data.labelId);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Sous-tâches (un seul niveau)
// ---------------------------------------------------------------------------

/** Longueur maximale d'un titre de sous-tâche — miroir de SUBTASK_TITLE_MAX. */
const SUBTASK_TITLE_LIMIT = 200;

export const listTaskSubtasksFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => taskInput.parse(input))
  .handler(async ({ data }): Promise<SubtaskView[]> => {
    const { actor } = await requireActor(getRequest().headers);
    const rows = await listSubtasks(actor, data.taskId);
    return rows.map(toSubtaskView);
  });

export const createTaskSubtaskFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        taskId: z.string().uuid(),
        title: z.string().trim().min(1).max(SUBTASK_TITLE_LIMIT),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<SubtaskView> => {
    const { actor } = await requireActor(getRequest().headers);
    const row = await createSubtask(actor, { taskId: data.taskId, title: data.title });
    return toSubtaskView(row);
  });

export const updateTaskSubtaskFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        subtaskId: z.string().uuid(),
        title: z.string().trim().min(1).max(SUBTASK_TITLE_LIMIT).optional(),
        isDone: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<SubtaskView> => {
    const { actor } = await requireActor(getRequest().headers);
    const { subtaskId, ...patch } = data;
    const row = await updateSubtask(actor, subtaskId, patch);
    return toSubtaskView(row);
  });

export const deleteTaskSubtaskFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ subtaskId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await deleteSubtask(actor, data.subtaskId);
    return { ok: true };
  });

export const reorderTaskSubtasksFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        taskId: z.string().uuid(),
        subtaskIds: z.array(z.string().uuid()).min(1),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<SubtaskView[]> => {
    const { actor } = await requireActor(getRequest().headers);
    const rows = await reorderSubtasks(actor, data.taskId, data.subtaskIds);
    return rows.map(toSubtaskView);
  });
