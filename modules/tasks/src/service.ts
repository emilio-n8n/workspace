import { getDb } from "@workspace/database";
import {
  type Actor,
  createGrant,
  type GrantRole,
  type GrantSubject,
  listGrants,
  type ResourceGrantRow,
  resolveRole,
  revokeGrant,
  roleSatisfies,
} from "@workspace/permissions";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  type Task,
  type TaskList,
  type TaskPriority,
  type TaskStatus,
  taskLists,
  tasks,
} from "./schema.ts";

export type TasksErrorCode = "not_found" | "forbidden" | "validation" | "conflict";

export class TasksError extends Error {
  readonly code: TasksErrorCode;
  constructor(code: TasksErrorCode, message: string) {
    super(message);
    this.name = "TasksError";
    this.code = code;
  }
}

const TITLE_MAX = 500;
const NOTES_MAX = 5000;

const db = () => getDb();

function assertTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length < 1 || trimmed.length > TITLE_MAX) {
    throw new TasksError(
      "validation",
      `Le titre doit contenir entre 1 et ${TITLE_MAX} caractères.`,
    );
  }
  const hasForbiddenChar = [...trimmed].some((char) => (char.codePointAt(0) ?? 0) < 0x20);
  if (hasForbiddenChar) {
    throw new TasksError("validation", "Le titre contient des caractères de contrôle.");
  }
  return trimmed;
}

function assertNotes(notes: string | null | undefined): string | null {
  if (notes === null || notes === undefined) return null;
  const trimmed = notes.trim();
  if (trimmed.length > NOTES_MAX) {
    throw new TasksError("validation", `Les notes sont limitées à ${NOTES_MAX} caractères.`);
  }
  return trimmed.length === 0 ? null : trimmed;
}

function parseDueAt(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TasksError("validation", "Échéance invalide.");
  }
  return date;
}

/** Rôle effectif sur une liste : propriétaire, sinon grants (type `task_list`). */
export async function effectiveListRole(actor: Actor, listId: string): Promise<GrantRole | null> {
  const [list] = await db()
    .select({ ownerId: taskLists.ownerId, orgId: taskLists.orgId })
    .from(taskLists)
    .where(eq(taskLists.id, listId))
    .limit(1);

  if (!list || list.orgId !== actor.orgId) return null;
  if (list.ownerId === actor.userId) return "owner";

  return resolveRole(actor, { type: "task_list", id: listId, orgId: actor.orgId });
}

async function assertList(
  actor: Actor,
  action: "read" | "write" | "share" | "delete",
  listId: string,
): Promise<TaskList> {
  const [list] = await db()
    .select()
    .from(taskLists)
    .where(and(eq(taskLists.id, listId), eq(taskLists.orgId, actor.orgId)))
    .limit(1);

  if (!list) throw new TasksError("not_found", "Liste introuvable.");

  const role = await effectiveListRole(actor, listId);
  if (!roleSatisfies(role, action)) {
    throw new TasksError("forbidden", "Permission insuffisante sur cette liste.");
  }
  return list;
}

export type TaskListWithRole = { list: TaskList; role: GrantRole };

/** Listes visibles de l'organisation (propriétaire ou grant hérité). */
export async function listLists(actor: Actor): Promise<TaskListWithRole[]> {
  const rows = await db()
    .select()
    .from(taskLists)
    .where(eq(taskLists.orgId, actor.orgId))
    .orderBy(asc(taskLists.name));

  const visible: TaskListWithRole[] = [];
  for (const row of rows) {
    const role = await effectiveListRole(actor, row.id);
    if (role) visible.push({ list: row, role });
  }
  return visible;
}

export async function createList(actor: Actor, input: { name: string }): Promise<TaskList> {
  const name = assertTitle(input.name);
  const [row] = await db()
    .insert(taskLists)
    .values({ orgId: actor.orgId, ownerId: actor.userId, name })
    .returning();
  if (!row) throw new TasksError("conflict", "Création impossible.");
  return row;
}

export async function renameList(actor: Actor, listId: string, name: string): Promise<TaskList> {
  const clean = assertTitle(name);
  await assertList(actor, "write", listId);

  const [row] = await db()
    .update(taskLists)
    .set({ name: clean })
    .where(eq(taskLists.id, listId))
    .returning();
  if (!row) throw new TasksError("not_found", "Liste introuvable.");
  return row;
}

/** Suppression : le propriétaire uniquement (les tâches suivent en cascade). */
export async function deleteList(actor: Actor, listId: string): Promise<void> {
  await assertList(actor, "delete", listId);
  await db().delete(taskLists).where(eq(taskLists.id, listId));
}

// ---------------------------------------------------------------------------
// Partage
// ---------------------------------------------------------------------------

export async function shareList(
  actor: Actor,
  listId: string,
  input: { subject: GrantSubject; role: GrantRole },
): Promise<ResourceGrantRow | null> {
  await assertList(actor, "share", listId);
  return createGrant({
    resource: { type: "task_list", id: listId, orgId: actor.orgId },
    subject: input.subject,
    role: input.role,
    actor,
  });
}

export async function unshareList(actor: Actor, listId: string, grantId: string): Promise<boolean> {
  await assertList(actor, "share", listId);
  return revokeGrant(grantId);
}

export async function listListGrants(actor: Actor, listId: string): Promise<ResourceGrantRow[]> {
  await assertList(actor, "share", listId);
  return listGrants({ type: "task_list", id: listId, orgId: actor.orgId });
}

// ---------------------------------------------------------------------------
// Tâches
// ---------------------------------------------------------------------------

/** Tâches d'une liste : non terminées d'abord, puis échéance croissante. */
export async function listTasks(actor: Actor, input: { listId: string }): Promise<Task[]> {
  await assertList(actor, "read", input.listId);
  return db()
    .select()
    .from(tasks)
    .where(eq(tasks.listId, input.listId))
    .orderBy(
      sql`case when ${tasks.status} = 'done' then 1 else 0 end`,
      sql`${tasks.dueAt} asc nulls last`,
      asc(tasks.createdAt),
    );
}

export async function createTask(
  actor: Actor,
  input: {
    listId: string;
    title: string;
    notes?: string | null;
    priority?: TaskPriority;
    dueAt?: string | null;
    assigneeId?: string | null;
  },
): Promise<Task> {
  await assertList(actor, "write", input.listId);

  const [row] = await db()
    .insert(tasks)
    .values({
      orgId: actor.orgId,
      listId: input.listId,
      createdBy: actor.userId,
      assigneeId: input.assigneeId ?? null,
      title: assertTitle(input.title),
      notes: assertNotes(input.notes),
      priority: input.priority ?? "medium",
      dueAt: parseDueAt(input.dueAt),
    })
    .returning();
  if (!row) throw new TasksError("conflict", "Création impossible.");
  return row;
}

export async function updateTask(
  actor: Actor,
  taskId: string,
  patch: {
    title?: string;
    notes?: string | null;
    priority?: TaskPriority;
    status?: TaskStatus;
    dueAt?: string | null;
    assigneeId?: string | null;
  },
): Promise<Task> {
  const [task] = await db()
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.orgId, actor.orgId)))
    .limit(1);
  if (!task) throw new TasksError("not_found", "Tâche introuvable.");

  await assertList(actor, "write", task.listId);

  const updates: Partial<typeof tasks.$inferInsert> = {};
  if (patch.title !== undefined) updates.title = assertTitle(patch.title);
  if (patch.notes !== undefined) updates.notes = assertNotes(patch.notes);
  if (patch.priority !== undefined) updates.priority = patch.priority;
  if (patch.dueAt !== undefined) updates.dueAt = parseDueAt(patch.dueAt);
  if (patch.assigneeId !== undefined) updates.assigneeId = patch.assigneeId;
  if (patch.status !== undefined) {
    updates.status = patch.status;
    updates.completedAt = patch.status === "done" ? new Date() : null;
  }

  const [row] = await db().update(tasks).set(updates).where(eq(tasks.id, taskId)).returning();
  if (!row) throw new TasksError("not_found", "Tâche introuvable.");
  return row;
}

export async function deleteTask(actor: Actor, taskId: string): Promise<void> {
  const [task] = await db()
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.orgId, actor.orgId)))
    .limit(1);
  if (!task) throw new TasksError("not_found", "Tâche introuvable.");

  await assertList(actor, "write", task.listId);
  await db().delete(tasks).where(eq(tasks.id, taskId));
}
