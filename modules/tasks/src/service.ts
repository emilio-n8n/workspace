import { recordAudit } from "@workspace/audit";
import { getAppUrls } from "@workspace/config";
import { schema as core, getDb, withTransaction } from "@workspace/database";
import { createNotification } from "@workspace/notifications";
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
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  type Subtask,
  type Task,
  type TaskLabel,
  type TaskLabelColor,
  type TaskList,
  type TaskPriority,
  type TaskStatus,
  taskLabelLinks,
  taskLabels,
  taskLists,
  taskSubtasks,
  tasks,
} from "./schema.ts";
import {
  nextSubtaskPosition,
  parentStatusAfterSubtaskChange,
  SUBTASK_TITLE_MAX,
  SUBTASKS_MAX,
  sortSubtasks,
} from "./subtasks.ts";

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
const LABEL_NAME_MAX = 40;

/** Palette offerte à la création d'une étiquette (mêmes valeurs que l'enum SQL). */
export const TASK_LABEL_COLORS: readonly TaskLabelColor[] = [
  "green",
  "blue",
  "amber",
  "violet",
  "red",
  "slate",
];

const db = () => getDb();

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code === "23505" || candidate?.cause?.code === "23505";
}

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

/**
 * Listes visibles de l'organisation (propriétaire ou grant hérité), dans
 * l'ordre du panneau : position croissante, puis `id` (uuidv7, ordonné dans le
 * temps) pour départager deux positions identiques.
 */
export async function listLists(actor: Actor): Promise<TaskListWithRole[]> {
  const rows = await db()
    .select()
    .from(taskLists)
    .where(eq(taskLists.orgId, actor.orgId))
    .orderBy(asc(taskLists.position), asc(taskLists.id));

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
    .values({
      orgId: actor.orgId,
      ownerId: actor.userId,
      name,
      // En fin de panneau : la position est calculée par la base, un `count(*)`
      // côté application était faux dès qu'une liste était supprimée.
      position: sql<number>`(select coalesce(max(${taskLists.position}), -1) + 1 from ${taskLists} where ${taskLists.orgId} = ${actor.orgId})`,
    })
    .returning();
  if (!row) throw new TasksError("conflict", "Création impossible.");
  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "tasks.list.create",
    resourceType: "task_list",
    resourceId: row.id,
    result: "success",
  });
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

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "tasks.list.delete",
    resourceType: "task_list",
    resourceId: listId,
    result: "success",
  });
}

/**
 * Réordonne le panneau des listes. `listIds` doit décrire EXACTEMENT les
 * listes visibles de l'acteur, sans doublon : ni oubli (la liste perdrait sa
 * place) ni identifiant étranger à l'organisation. L'écriture est exigée sur
 * chaque liste — l'ordre est partagé par toute l'organisation.
 */
export async function reorderLists(
  actor: Actor,
  listIds: readonly string[],
): Promise<TaskListWithRole[]> {
  if (listIds.length === 0) {
    throw new TasksError("validation", "L'ordre des listes est vide.");
  }
  if (new Set(listIds).size !== listIds.length) {
    throw new TasksError("validation", "Une liste ne peut pas apparaître deux fois dans l'ordre.");
  }

  const visible = await listLists(actor);
  const visibleIds = visible.map((entry) => entry.list.id);
  const submitted = new Set(listIds);
  if (submitted.size !== visibleIds.length || visibleIds.some((id) => !submitted.has(id))) {
    throw new TasksError("validation", "L'ordre soumis ne correspond pas à vos listes.");
  }
  for (const entry of visible) {
    if (!roleSatisfies(entry.role, "write")) {
      throw new TasksError("forbidden", "Permission insuffisante sur cette liste.");
    }
  }

  await withTransaction(async (tx) => {
    for (const [position, listId] of listIds.entries()) {
      await tx.update(taskLists).set({ position }).where(eq(taskLists.id, listId));
    }
  });

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "tasks.list.reorder",
    resourceType: "task_list",
    result: "success",
    metadata: { lists: listIds.length },
  });

  return listLists(actor);
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
  const grant = await createGrant({
    resource: { type: "task_list", id: listId, orgId: actor.orgId },
    subject: input.subject,
    role: input.role,
    actor,
  });
  // Doublon ignoré par l'unicité → aucune mutation, donc aucune ligne d'audit.
  if (grant) {
    await recordAudit({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "tasks.list.share",
      resourceType: "task_list",
      resourceId: listId,
      result: "success",
      metadata: { subjectKind: input.subject.kind, subjectId: input.subject.id, role: input.role },
    });
  }
  return grant;
}

export async function unshareList(actor: Actor, listId: string, grantId: string): Promise<boolean> {
  await assertList(actor, "share", listId);
  const revoked = await revokeGrant({ type: "task_list", id: listId, orgId: actor.orgId }, grantId);
  // Révocation sans effet (grant inexistant) → aucune mutation à journaliser.
  if (revoked) {
    await recordAudit({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "tasks.list.unshare",
      resourceType: "task_list",
      resourceId: listId,
      result: "success",
    });
  }
  return revoked;
}

export async function listListGrants(actor: Actor, listId: string): Promise<ResourceGrantRow[]> {
  await assertList(actor, "share", listId);
  return listGrants({ type: "task_list", id: listId, orgId: actor.orgId });
}

// ---------------------------------------------------------------------------
// Tâches
// ---------------------------------------------------------------------------

export type TaskWithLabels = Task & {
  labels: TaskLabel[];
  /** Nombre de sous-tâches, et combien sont faites (0/0 = pas de sous-tâche). */
  subtaskTotal: number;
  subtaskDone: number;
};

/** Étiquettes d'un lot de tâches, en une requête (jamais une requête par tâche). */
async function attachLabels(orgId: string, rows: readonly Task[]): Promise<TaskWithLabels[]> {
  if (rows.length === 0) return [];
  const links = await db()
    .select({ taskId: taskLabelLinks.taskId, label: taskLabels })
    .from(taskLabelLinks)
    .innerJoin(taskLabels, eq(taskLabelLinks.labelId, taskLabels.id))
    .where(
      and(
        eq(taskLabels.orgId, orgId),
        inArray(
          taskLabelLinks.taskId,
          rows.map((row) => row.id),
        ),
      ),
    );

  const byTask = new Map<string, TaskLabel[]>();
  for (const link of links) {
    const bucket = byTask.get(link.taskId);
    if (bucket) bucket.push(link.label);
    else byTask.set(link.taskId, [link.label]);
  }

  return rows.map((row) => ({
    ...row,
    // Ordre stable lisible : nom d'étiquette, départagé par son identifiant.
    labels: (byTask.get(row.id) ?? []).sort(
      (a, b) => a.name.localeCompare(b.name, "fr") || a.id.localeCompare(b.id),
    ),
    subtaskTotal: 0,
    subtaskDone: 0,
  }));
}

/** Compteurs de sous-tâches du lot, en une requête agrégée. */
async function attachSubtaskCounts(rows: TaskWithLabels[]): Promise<TaskWithLabels[]> {
  if (rows.length === 0) return rows;
  const counts = await db()
    .select({
      taskId: taskSubtasks.taskId,
      total: sql<number>`count(*)`.mapWith(Number),
      done: sql<number>`count(*) filter (where ${taskSubtasks.isDone})`.mapWith(Number),
    })
    .from(taskSubtasks)
    .where(
      inArray(
        taskSubtasks.taskId,
        rows.map((row) => row.id),
      ),
    )
    .groupBy(taskSubtasks.taskId);

  const byTask = new Map(counts.map((row) => [row.taskId, row]));
  return rows.map((row) => {
    const count = byTask.get(row.id);
    return count ? { ...row, subtaskTotal: count.total, subtaskDone: count.done } : row;
  });
}

/**
 * Tâches d'une liste.
 *
 * `order: "default"` (le défaut, comportement historique) : non terminées
 * d'abord, échéance croissante, création croissante. `order: "manual"` :
 * l'ordre glissé par l'utilisateur (`position`, puis création) — c'est le seul
 * ordre dans lequel le glisser-déposer a un sens.
 */
export async function listTasks(
  actor: Actor,
  input: { listId: string; order?: "default" | "manual" },
): Promise<TaskWithLabels[]> {
  await assertList(actor, "read", input.listId);

  const rows =
    input.order === "manual"
      ? await db()
          .select()
          .from(tasks)
          .where(eq(tasks.listId, input.listId))
          .orderBy(asc(tasks.position), asc(tasks.createdAt))
      : await db()
          .select()
          .from(tasks)
          .where(eq(tasks.listId, input.listId))
          .orderBy(
            sql`case when ${tasks.status} = 'done' then 1 else 0 end`,
            sql`${tasks.dueAt} asc nulls last`,
            asc(tasks.createdAt),
          );

  return attachSubtaskCounts(await attachLabels(actor.orgId, rows));
}

export type MyTasksWindow = "today" | "week" | "all";

export type MyTaskEntry = { task: TaskWithLabels; listName: string };

/** Bornes de l'agrégat « Mes tâches » : on ne parcourt jamais tout l'espace de travail. */
const MY_TASKS_MAX_LISTS = 30;
const MY_TASKS_MAX_SCAN = 500;
const MY_TASKS_DEFAULT_LIMIT = 200;
const MY_TASKS_MAX_LIMIT = 500;

const PRIORITY_RANK: Record<TaskPriority, number> = { low: 0, medium: 1, high: 2 };

/** Fin de la journée locale du serveur (23:59:59.999). */
function endOfDay(reference: Date): Date {
  const end = new Date(reference);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * « Mes tâches » transverses : tout ce qui m'est assigné ou à prendre, toutes
 * listes visibles confondues (`listLists` puis `listTasks` par liste).
 *
 * Règle de sélection, par liste : une tâche est retenue si elle m'est assignée,
 * ou bien si elle n'est assignée à personne, n'est pas terminée et que mon rôle
 * sur la liste autorise l'écriture (editor/owner — `listLists` renvoie déjà le
 * rôle). Les tâches terminées sont toujours exclues : elles appartiennent à
 * l'historique.
 *
 * Fenêtres : « today » garde les échéances jusqu'à la fin de la journée (les
 * tâches sans échéance sont écartées), « week » jusqu'à maintenant + 7 jours,
 * « all » ne filtre pas les dates.
 *
 * Tri : échéance croissante (les retards d'abord, sans échéance en dernier),
 * puis priorité haute → basse, puis création croissante. Bornes : 30 listes et
 * 500 tâches scannées au maximum ; `limit` résultats (défaut 200, max 500).
 */
export async function listMyTasks(
  actor: Actor,
  input?: { window?: MyTasksWindow; limit?: number },
): Promise<MyTaskEntry[]> {
  const window = input?.window ?? "all";
  const limit = input?.limit ?? MY_TASKS_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MY_TASKS_MAX_LIMIT) {
    throw new TasksError(
      "validation",
      `La limite doit être un entier entre 1 et ${MY_TASKS_MAX_LIMIT}.`,
    );
  }

  const now = new Date();
  const cutoff =
    window === "today"
      ? endOfDay(now)
      : window === "week"
        ? new Date(now.getTime() + 7 * 86_400_000)
        : null;

  const visibleLists = (await listLists(actor)).slice(0, MY_TASKS_MAX_LISTS);

  const entries: MyTaskEntry[] = [];
  let scanned = 0;
  for (const { list, role } of visibleLists) {
    if (scanned >= MY_TASKS_MAX_SCAN) break;
    const canAssume = roleSatisfies(role, "write");
    for (const task of await listTasks(actor, { listId: list.id })) {
      if (scanned >= MY_TASKS_MAX_SCAN) break;
      scanned += 1;
      if (task.status === "done") continue;
      const mine = task.assigneeId === actor.userId;
      const assumable = task.assigneeId === null && canAssume;
      if (!mine && !assumable) continue;
      if (cutoff !== null && (task.dueAt === null || task.dueAt > cutoff)) continue;
      entries.push({ task, listName: list.name });
    }
  }

  entries.sort((a, b) => {
    const aDue = a.task.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const bDue = b.task.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;
    const byPriority = PRIORITY_RANK[b.task.priority] - PRIORITY_RANK[a.task.priority];
    if (byPriority !== 0) return byPriority;
    return a.task.createdAt.getTime() - b.task.createdAt.getTime();
  });

  return entries.slice(0, limit);
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
    labelIds?: readonly string[];
  },
): Promise<Task> {
  await assertList(actor, "write", input.listId);

  // Nouvelle tâche en fin de liste pour l'ordre manuel : sans cela, toutes les
  // créations se disputeraient la position 0 et remonteraient en tête.
  const [head] = await db()
    .select({ next: sql<number>`coalesce(max(${tasks.position}), -1) + 1`.mapWith(Number) })
    .from(tasks)
    .where(eq(tasks.listId, input.listId));

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
      position: head?.next ?? 0,
    })
    .returning();
  if (!row) throw new TasksError("conflict", "Création impossible.");
  if (input.labelIds) await replaceTaskLabels(actor, row.id, input.labelIds);
  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "tasks.task.create",
    resourceType: "task",
    resourceId: row.id,
    result: "success",
  });
  return row;
}

/**
 * Mise à jour d'une tâche. Volontairement NON journalisée dans l'audit : la
 * bascule d'une case à cocher, le changement de priorité ou de date sont des
 * micro-interactions à fort volume. L'audit couvre les créations/suppressions
 * et le partage des listes.
 */
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
    labelIds?: readonly string[];
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

  // Les étiquettes vivent dans leur propre table : elles sont remplacées ici,
  // avant (ou sans) la mise à jour de la tâche elle-même.
  if (patch.labelIds !== undefined) await replaceTaskLabels(actor, taskId, patch.labelIds);

  // Une mise à jour qui ne porte QUE sur les étiquettes n'a rien à écrire dans
  // la table `tasks` : on saute l'UPDATE plutôt que d'envoyer un `set()` vide.
  let updated = task;
  if (Object.keys(updates).length > 0) {
    const [row] = await db().update(tasks).set(updates).where(eq(tasks.id, taskId)).returning();
    if (!row) throw new TasksError("not_found", "Tâche introuvable.");
    updated = row;
  }

  // Notification best-effort : la tâche change d'assigné et le nouveau
  // destinataire est membre de l'organisation.
  const nextAssignee = patch.assigneeId;
  if (nextAssignee !== undefined && nextAssignee !== null && nextAssignee !== task.assigneeId) {
    const [membership] = await db()
      .select({ userId: core.member.userId })
      .from(core.member)
      .where(and(eq(core.member.userId, nextAssignee), eq(core.member.organizationId, actor.orgId)))
      .limit(1);
    if (membership) {
      await createNotification({
        orgId: actor.orgId,
        userId: nextAssignee,
        kind: "task_assigned",
        title: `Tâche assignée : « ${updated.title} »`,
        href: getAppUrls().tasks,
      }).catch(() => undefined);
    }
  }

  return updated;
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

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "tasks.task.delete",
    resourceType: "task",
    resourceId: taskId,
    result: "success",
  });
}

/**
 * Réordonne les tâches d'une liste à la main. `taskIds` doit décrire EXACTEMENT
 * les tâches de la liste (ni oubli, ni identifiant étranger, ni doublon) :
 * l'ordre est partagé par toute l'organisation, un ordre partiel laisserait des
 * lignes à 0 et les ferait remonter en tête.
 */
export async function reorderTasks(
  actor: Actor,
  listId: string,
  taskIds: readonly string[],
): Promise<void> {
  await assertList(actor, "write", listId);

  const rows = await db().select({ id: tasks.id }).from(tasks).where(eq(tasks.listId, listId));
  const knownIds = new Set(rows.map((row) => row.id));
  const submitted = new Set(taskIds);

  if (taskIds.length === 0) {
    throw new TasksError("validation", "L'ordre des tâches est vide.");
  }
  if (submitted.size !== taskIds.length) {
    throw new TasksError("validation", "Une tâche ne peut pas apparaître deux fois dans l'ordre.");
  }
  if (submitted.size !== knownIds.size || taskIds.some((id) => !knownIds.has(id))) {
    throw new TasksError("validation", "L'ordre soumis ne correspond pas aux tâches de la liste.");
  }

  await withTransaction(async (tx) => {
    for (const [position, taskId] of taskIds.entries()) {
      await tx.update(tasks).set({ position }).where(eq(tasks.id, taskId));
    }
  });

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "tasks.task.reorder",
    resourceType: "task_list",
    resourceId: listId,
    result: "success",
    metadata: { tasks: taskIds.length },
  });
}

// ---------------------------------------------------------------------------
// Sous-tâches (un seul niveau)
// ---------------------------------------------------------------------------

function assertSubtaskTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length < 1 || trimmed.length > SUBTASK_TITLE_MAX) {
    throw new TasksError(
      "validation",
      `La sous-tâche doit contenir entre 1 et ${SUBTASK_TITLE_MAX} caractères.`,
    );
  }
  const hasForbiddenChar = [...trimmed].some((char) => (char.codePointAt(0) ?? 0) < 0x20);
  if (hasForbiddenChar) {
    throw new TasksError("validation", "La sous-tâche contient des caractères de contrôle.");
  }
  return trimmed;
}

/** Charge une tâche et vérifie l'action demandée sur sa liste. */
async function requireTask(actor: Actor, taskId: string, action: "read" | "write"): Promise<Task> {
  const [task] = await db()
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.orgId, actor.orgId)))
    .limit(1);
  if (!task) throw new TasksError("not_found", "Tâche introuvable.");

  await assertList(actor, action, task.listId);
  return task;
}

async function loadSubtasks(taskId: string): Promise<Subtask[]> {
  const rows = await db()
    .select()
    .from(taskSubtasks)
    .where(eq(taskSubtasks.taskId, taskId))
    .orderBy(asc(taskSubtasks.position), asc(taskSubtasks.id));
  return sortSubtasks(rows);
}

/**
 * Totaux de sous-tâches d'une tâche, pour la puce de progression affichée sur
 * la ligne. Volontairement séparé de `listSubtasks` : l'écran n'a pas besoin
 * des titres pour afficher « 2/3 ».
 */
export async function countSubtasks(
  actor: Actor,
  taskId: string,
): Promise<{ total: number; done: number }> {
  await requireTask(actor, taskId, "read");
  const [row] = await db()
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      done: sql<number>`count(*) filter (where ${taskSubtasks.isDone})`.mapWith(Number),
    })
    .from(taskSubtasks)
    .where(eq(taskSubtasks.taskId, taskId));
  return { total: row?.total ?? 0, done: row?.done ?? 0 };
}

/** Sous-tâches d'une tâche, dans l'ordre affiché.
 */
export async function listSubtasks(actor: Actor, taskId: string): Promise<Subtask[]> {
  await requireTask(actor, taskId, "read");
  return loadSubtasks(taskId);
}

export async function createSubtask(
  actor: Actor,
  input: { taskId: string; title: string },
): Promise<Subtask> {
  const task = await requireTask(actor, input.taskId, "write");
  const title = assertSubtaskTitle(input.title);

  const existing = await loadSubtasks(task.id);
  if (existing.length >= SUBTASKS_MAX) {
    throw new TasksError(
      "validation",
      `Une tâche ne peut pas dépasser ${SUBTASKS_MAX} sous-tâches.`,
    );
  }

  const [row] = await db()
    .insert(taskSubtasks)
    .values({ taskId: task.id, title, position: nextSubtaskPosition(existing) })
    .returning();
  if (!row) throw new TasksError("conflict", "Création de la sous-tâche impossible.");
  return row;
}

/**
 * Met à jour une sous-tâche, puis synchronise la tâche parente : toutes les
 * sous-tâches faites terminent la parente, une sous-tâche rouverte la rouvre.
 * La règle vit dans `parentStatusAfterSubtaskChange` (logique pure, testée).
 */
export async function updateSubtask(
  actor: Actor,
  subtaskId: string,
  patch: { title?: string; isDone?: boolean },
): Promise<Subtask> {
  const [current] = await db()
    .select()
    .from(taskSubtasks)
    .where(eq(taskSubtasks.id, subtaskId))
    .limit(1);
  if (!current) throw new TasksError("not_found", "Sous-tâche introuvable.");

  const task = await requireTask(actor, current.taskId, "write");

  const updates: Partial<typeof taskSubtasks.$inferInsert> = {};
  if (patch.title !== undefined) updates.title = assertSubtaskTitle(patch.title);
  if (patch.isDone !== undefined) updates.isDone = patch.isDone;
  if (Object.keys(updates).length === 0) return current;

  const [row] = await db()
    .update(taskSubtasks)
    .set(updates)
    .where(eq(taskSubtasks.id, subtaskId))
    .returning();
  if (!row) throw new TasksError("not_found", "Sous-tâche introuvable.");

  await syncParentFromSubtasks(task);
  return row;
}

export async function deleteSubtask(actor: Actor, subtaskId: string): Promise<void> {
  const [current] = await db()
    .select({ id: taskSubtasks.id, taskId: taskSubtasks.taskId })
    .from(taskSubtasks)
    .where(eq(taskSubtasks.id, subtaskId))
    .limit(1);
  if (!current) throw new TasksError("not_found", "Sous-tâche introuvable.");

  await requireTask(actor, current.taskId, "write");
  await db().delete(taskSubtasks).where(eq(taskSubtasks.id, subtaskId));
}

/**
 * Réordonnancement simple des sous-tâches. `subtaskIds` doit décrire EXACTEMENT
 * les sous-tâches de la tâche : un ordre partiel laisserait des trous, donc des
 * lignes mal placées au rechargement.
 */
export async function reorderSubtasks(
  actor: Actor,
  taskId: string,
  subtaskIds: readonly string[],
): Promise<Subtask[]> {
  await requireTask(actor, taskId, "write");

  const existing = await loadSubtasks(taskId);
  const knownIds = new Set(existing.map((row) => row.id));
  const submitted = new Set(subtaskIds);

  if (subtaskIds.length === 0) {
    throw new TasksError("validation", "L'ordre des sous-tâches est vide.");
  }
  if (submitted.size !== subtaskIds.length) {
    throw new TasksError(
      "validation",
      "Une sous-tâche ne peut pas apparaître deux fois dans l'ordre.",
    );
  }
  if (submitted.size !== knownIds.size || subtaskIds.some((id) => !knownIds.has(id))) {
    throw new TasksError(
      "validation",
      "L'ordre soumis ne correspond pas aux sous-tâches de la tâche.",
    );
  }

  await withTransaction(async (tx) => {
    for (const [position, subtaskId] of subtaskIds.entries()) {
      await tx.update(taskSubtasks).set({ position }).where(eq(taskSubtasks.id, subtaskId));
    }
  });

  return loadSubtasks(taskId);
}

/**
 * Aligne le statut de la tâche parente sur ses sous-tâches.
 */
async function syncParentFromSubtasks(task: Task): Promise<void> {
  const rows = await db()
    .select({ isDone: taskSubtasks.isDone })
    .from(taskSubtasks)
    .where(eq(taskSubtasks.taskId, task.id));

  const decision = parentStatusAfterSubtaskChange({
    parentStatus: task.status,
    subtasks: rows,
  });
  if (!decision.changed) return;

  await db()
    .update(tasks)
    .set({
      status: decision.status,
      completedAt: decision.status === "done" ? new Date() : null,
    })
    .where(eq(tasks.id, task.id));
}

// ---------------------------------------------------------------------------
// Étiquettes
// ---------------------------------------------------------------------------

function assertLabelName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > LABEL_NAME_MAX) {
    throw new TasksError(
      "validation",
      `Le nom de l'étiquette doit contenir entre 1 et ${LABEL_NAME_MAX} caractères.`,
    );
  }
  const hasForbiddenChar = [...trimmed].some((char) => (char.codePointAt(0) ?? 0) < 0x20);
  if (hasForbiddenChar) {
    throw new TasksError(
      "validation",
      "Le nom de l'étiquette contient des caractères de contrôle.",
    );
  }
  return trimmed;
}

function assertLabelColor(color: string): TaskLabelColor {
  if (!TASK_LABEL_COLORS.includes(color as TaskLabelColor)) {
    throw new TasksError("validation", "Couleur d'étiquette inconnue.");
  }
  return color as TaskLabelColor;
}

/**
 * Les étiquettes sont une ressource d'ORGANISATION, pas de liste : tout membre
 * de l'organisation les gère (créer, renommer, recolorer, supprimer) et les
 * voit, sans égard aux listes qu'il fréquente. Chaque requête est filtrée sur
 * `org_id`, donc aucune fuite inter-organisations n'est possible.
 */
/** Étiquettes de l'organisation, par ordre alphabétique français. */
export async function listLabels(actor: Actor): Promise<TaskLabel[]> {
  return db()
    .select()
    .from(taskLabels)
    .where(eq(taskLabels.orgId, actor.orgId))
    .orderBy(asc(taskLabels.name));
}

export async function createLabel(
  actor: Actor,
  input: { name: string; color?: string },
): Promise<TaskLabel> {
  const name = assertLabelName(input.name);
  const color = assertLabelColor(input.color ?? "blue");

  try {
    const [row] = await db()
      .insert(taskLabels)
      .values({ orgId: actor.orgId, createdBy: actor.userId, name, color })
      .returning();
    // Contrainte d'unicité (organisation + nom) : deux étiquettes homonymes
    // rendraient la liste de choix ambiguë.
    if (!row) throw new TasksError("conflict", "Cette étiquette existe déjà.");

    await recordAudit({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "tasks.label.create",
      resourceType: "task_label",
      resourceId: row.id,
      result: "success",
      metadata: { name: row.name, color: row.color },
    });
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new TasksError("conflict", "Cette étiquette existe déjà.");
    }
    throw error;
  }
}

export async function updateLabel(
  actor: Actor,
  labelId: string,
  patch: { name?: string; color?: string },
): Promise<TaskLabel> {
  const updates: Partial<typeof taskLabels.$inferInsert> = {};
  if (patch.name !== undefined) updates.name = assertLabelName(patch.name);
  if (patch.color !== undefined) updates.color = assertLabelColor(patch.color);
  if (Object.keys(updates).length === 0) {
    const [current] = await db()
      .select()
      .from(taskLabels)
      .where(and(eq(taskLabels.id, labelId), eq(taskLabels.orgId, actor.orgId)))
      .limit(1);
    if (!current) throw new TasksError("not_found", "Étiquette introuvable.");
    return current;
  }

  try {
    const [row] = await db()
      .update(taskLabels)
      .set(updates)
      .where(and(eq(taskLabels.id, labelId), eq(taskLabels.orgId, actor.orgId)))
      .returning();
    if (!row) throw new TasksError("not_found", "Étiquette introuvable.");
    return row;
  } catch (error) {
    // Le renommage bute sur une étiquette homonyme : on le dit en français.
    if (isUniqueViolation(error)) {
      throw new TasksError("conflict", "Cette étiquette existe déjà.");
    }
    throw error;
  }
}

/** Suppression : les liaisons avec les tâches suivent en cascade. */
export async function deleteLabel(actor: Actor, labelId: string): Promise<void> {
  const deleted = await db()
    .delete(taskLabels)
    .where(and(eq(taskLabels.id, labelId), eq(taskLabels.orgId, actor.orgId)))
    .returning({ id: taskLabels.id });
  if (deleted.length === 0) throw new TasksError("not_found", "Étiquette introuvable.");

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "tasks.label.delete",
    resourceType: "task_label",
    resourceId: labelId,
    result: "success",
  });
}

/** Étiquettes d'une tâche (lecture seule : droits de la liste porteuse). */
export async function listTaskLabels(actor: Actor, taskId: string): Promise<TaskLabel[]> {
  const [task] = await db()
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.orgId, actor.orgId)))
    .limit(1);
  if (!task) throw new TasksError("not_found", "Tâche introuvable.");

  await assertList(actor, "read", task.listId);
  return db()
    .select({ label: taskLabels })
    .from(taskLabelLinks)
    .innerJoin(taskLabels, eq(taskLabelLinks.labelId, taskLabels.id))
    .where(and(eq(taskLabelLinks.taskId, taskId), eq(taskLabels.orgId, actor.orgId)))
    .orderBy(asc(taskLabels.name))
    .then((rows) => rows.map((row) => row.label));
}

/**
 * Remplace les étiquettes d'une tâche par `labelIds`. L'écriture sur la liste
 * porteuse est exigée, et chaque étiquette doit appartenir à la même
 * organisation : aucune fuite inter-organisations par ce biais.
 */
export async function setTaskLabels(
  actor: Actor,
  taskId: string,
  labelIds: readonly string[],
): Promise<TaskLabel[]> {
  const [task] = await db()
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.orgId, actor.orgId)))
    .limit(1);
  if (!task) throw new TasksError("not_found", "Tâche introuvable.");

  await assertList(actor, "write", task.listId);
  await replaceTaskLabels(actor, taskId, labelIds);
  return listTaskLabels(actor, taskId);
}

async function replaceTaskLabels(
  actor: Actor,
  taskId: string,
  labelIds: readonly string[],
): Promise<void> {
  const wanted = [...new Set(labelIds)];
  if (wanted.length > 0) {
    const known = await db()
      .select({ id: taskLabels.id })
      .from(taskLabels)
      .where(and(eq(taskLabels.orgId, actor.orgId), inArray(taskLabels.id, wanted)));
    if (known.length !== wanted.length) {
      throw new TasksError("validation", "Une étiquette est introuvable dans votre organisation.");
    }
  }

  await withTransaction(async (tx) => {
    await tx.delete(taskLabelLinks).where(eq(taskLabelLinks.taskId, taskId));
    if (wanted.length > 0) {
      await tx.insert(taskLabelLinks).values(wanted.map((labelId) => ({ taskId, labelId })));
    }
  });
}
