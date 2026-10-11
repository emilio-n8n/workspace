import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireActor } from "@workspace/auth";
import { schema as coreSchema, getDb } from "@workspace/database";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  createList,
  createTask,
  deleteList,
  deleteTask,
  listListGrants,
  listLists,
  listTasks,
  renameList,
  shareList,
  type Task,
  unshareList,
  updateTask,
} from "./index.ts";

export type TaskListView = { id: string; name: string; role: string; isOwner: boolean };
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
};
export type MemberView = { userId: string; name: string; email: string };
export type ListGrantView = { id: string; subjectLabel: string; role: string };

function toTaskView(task: Task): TaskView {
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
    }));
  },
);

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

export const listTasksFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => listInput.parse(input))
  .handler(async ({ data }): Promise<TaskView[]> => {
    const { actor } = await requireActor(getRequest().headers);
    const rows = await listTasks(actor, { listId: data.listId });
    return rows.map(toTaskView);
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
    });
    return toTaskView(task);
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
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    const { taskId, ...patch } = data;
    const task = await updateTask(actor, taskId, patch);
    return toTaskView(task);
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
    return db
      .select({
        userId: coreSchema.user.id,
        name: coreSchema.user.name,
        email: coreSchema.user.email,
      })
      .from(coreSchema.member)
      .innerJoin(coreSchema.user, eq(coreSchema.member.userId, coreSchema.user.id))
      .where(eq(coreSchema.member.organizationId, actor.orgId))
      .orderBy(asc(coreSchema.user.name));
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
