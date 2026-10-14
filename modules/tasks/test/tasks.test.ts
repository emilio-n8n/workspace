import { randomUUID } from "node:crypto";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import { type Actor, createGrant, revokeGrant } from "@workspace/permissions";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
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
  effectiveListRole,
  listLabels,
  listListGrants,
  listLists,
  listMyTasks,
  listSubtasks,
  listTaskLabels,
  listTasks,
  renameList,
  reorderLists,
  reorderSubtasks,
  reorderTasks,
  setTaskLabels,
  shareList,
  TasksError,
  taskSubtasks,
  unshareList,
  updateLabel,
  updateSubtask,
  updateTask,
} from "../src/index.ts";

const { user, organization, auditEvents } = coreSchema;

let counter = 0;
const tag = (prefix: string) => `${prefix}${++counter}_${randomUUID().slice(0, 8)}`;

type Fixtures = {
  orgId: string;
  otherOrgId: string;
  alice: string;
  bruno: string;
  chloe: string;
  actorAlice: Actor;
  actorBruno: Actor;
  actorChloe: Actor;
};

async function createFixtures(): Promise<Fixtures> {
  const db = getDb();
  const now = new Date();

  const orgId = tag("org");
  const otherOrgId = tag("org");
  await db.insert(organization).values([
    { id: orgId, name: tag("Org "), slug: orgId, createdAt: now },
    { id: otherOrgId, name: tag("Org "), slug: otherOrgId, createdAt: now },
  ]);

  const makeUser = async (name: string) => {
    const id = tag("usr");
    await db.insert(user).values({
      id,
      name,
      email: `${id}@example.org`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  };

  const alice = await makeUser("Alice");
  const bruno = await makeUser("Bruno");
  const chloe = await makeUser("Chloe");

  return {
    orgId,
    otherOrgId,
    alice,
    bruno,
    chloe,
    actorAlice: { userId: alice, orgId },
    actorBruno: { userId: bruno, orgId },
    actorChloe: { userId: chloe, orgId: otherOrgId },
  };
}

async function cleanup(f: Fixtures): Promise<void> {
  const db = getDb();
  await db.delete(auditEvents).where(eq(auditEvents.orgId, f.orgId));
  await db.delete(auditEvents).where(eq(auditEvents.orgId, f.otherOrgId));
  await db.delete(organization).where(eq(organization.id, f.orgId));
  await db.delete(organization).where(eq(organization.id, f.otherOrgId));
  for (const id of [f.alice, f.bruno, f.chloe]) await db.delete(user).where(eq(user.id, id));
}

/** Nombre de lignes d'audit rattachées à une organisation. */
async function countAuditRows(orgId: string): Promise<number> {
  const [row] = await getDb()
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(auditEvents)
    .where(eq(auditEvents.orgId, orgId));
  return row?.value ?? 0;
}

let f: Fixtures;

beforeEach(async () => {
  f = await createFixtures();
});

afterEach(async () => {
  await cleanup(f);
});

afterAll(async () => {
  await closeDb();
});

describe("tasks — listes et refus par défaut", () => {
  it("crée, renomme et liste ; Bruno ne voit rien sans partage", async () => {
    const list = await createList(f.actorAlice, { name: "Projet Alpha" });
    expect(await effectiveListRole(f.actorAlice, list.id)).toBe("owner");
    expect(await effectiveListRole(f.actorBruno, list.id)).toBeNull();

    expect(await listLists(f.actorBruno)).toHaveLength(0);

    const renamed = await renameList(f.actorAlice, list.id, "Projet Beta");
    expect(renamed.name).toBe("Projet Beta");
    expect((await listLists(f.actorAlice))[0]?.list.name).toBe("Projet Beta");
    expect((await listLists(f.actorAlice))[0]?.role).toBe("owner");
  });

  it("refuse les noms invalides", async () => {
    await expect(createList(f.actorAlice, { name: "  " })).rejects.toMatchObject({
      name: "TasksError",
      code: "validation",
    });
    await expect(
      createList(f.actorAlice, { name: `x\n${"y".repeat(600)}` }),
    ).rejects.toBeInstanceOf(TasksError);
  });

  it("isolation inter-organisations : not_found, même pour lire", async () => {
    const list = await createList(f.actorAlice, { name: "Privé" });
    await expect(listTasks(f.actorChloe, { listId: list.id })).rejects.toMatchObject({
      code: "not_found",
    });
    expect(await listLists(f.actorChloe)).toHaveLength(0);
  });
});

describe("tasks — cycle de vie des tâches", () => {
  it("crée, assigne, termine (completedAt), réouvre, puis supprime", async () => {
    const list = await createList(f.actorAlice, { name: "Tâches" });

    const task = await createTask(f.actorAlice, {
      listId: list.id,
      title: "Écrire le contrat",
      priority: "high",
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      assigneeId: f.bruno,
    });
    expect(task.status).toBe("todo");
    expect(task.assigneeId).toBe(f.bruno);
    expect(task.completedAt).toBeNull();

    const done = await updateTask(f.actorAlice, task.id, { status: "done" });
    expect(done.completedAt).not.toBeNull();

    const reopened = await updateTask(f.actorAlice, task.id, { status: "todo" });
    expect(reopened.completedAt).toBeNull();

    await deleteTask(f.actorAlice, task.id);
    expect(await listTasks(f.actorAlice, { listId: list.id })).toHaveLength(0);
  });

  it("ordonne : non terminées d'abord, échéances croissantes", async () => {
    const list = await createList(f.actorAlice, { name: "Ordre" });
    const later = await createTask(f.actorAlice, {
      listId: list.id,
      title: "Plus tard",
      dueAt: new Date(Date.now() + 172_800_000).toISOString(),
    });
    const sooner = await createTask(f.actorAlice, {
      listId: list.id,
      title: "Bientôt",
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const done = await createTask(f.actorAlice, { listId: list.id, title: "Terminée" });
    await updateTask(f.actorAlice, done.id, { status: "done" });

    const rows = await listTasks(f.actorAlice, { listId: list.id });
    expect(rows.map((row) => row.id)).toEqual([sooner.id, later.id, done.id]);
  });

  it("échéance invalide rejetée ; échéance effaçable", async () => {
    const list = await createList(f.actorAlice, { name: "Dates" });
    await expect(
      createTask(f.actorAlice, { listId: list.id, title: "X", dueAt: "pas-une-date" }),
    ).rejects.toMatchObject({ code: "validation" });

    const task = await createTask(f.actorAlice, { listId: list.id, title: "Y" });
    const cleared = await updateTask(f.actorAlice, task.id, { dueAt: null });
    expect(cleared.dueAt).toBeNull();
  });

  it("notifie le nouvel assigné membre de l'organisation", async () => {
    const db = getDb();
    await db.insert(coreSchema.member).values({
      id: tag("mem"),
      organizationId: f.orgId,
      userId: f.bruno,
      role: "member",
      createdAt: new Date(),
    });

    const list = await createList(f.actorAlice, { name: "Notifications" });
    const task = await createTask(f.actorAlice, { listId: list.id, title: "Relire le dossier" });

    await updateTask(f.actorAlice, task.id, { assigneeId: f.bruno });

    // La réassignation crée une notification pour Bruno (table cœur).
    const [notification] = await db
      .select()
      .from(coreSchema.notifications)
      .where(eq(coreSchema.notifications.userId, f.bruno));
    expect(notification).toMatchObject({
      orgId: f.orgId,
      kind: "task_assigned",
      title: "Tâche assignée : « Relire le dossier »",
      href: "http://localhost:3003",
      readAt: null,
    });
  });
});

describe("tasks — partage et permissions", () => {
  it("viewer lit sans modifier ; editor modifie ; révocation immédiate", async () => {
    const list = await createList(f.actorAlice, { name: "Partagée" });
    await createTask(f.actorAlice, { listId: list.id, title: "Visible" });

    const grant = await shareList(f.actorAlice, list.id, {
      subject: { kind: "user", id: f.bruno },
      role: "viewer",
    });
    expect(grant).not.toBeNull();
    if (!grant) throw new Error("Partage non créé.");

    expect((await listLists(f.actorBruno))[0]?.role).toBe("viewer");
    const visible = await listTasks(f.actorBruno, { listId: list.id });
    expect(visible).toHaveLength(1);

    await expect(
      createTask(f.actorBruno, { listId: list.id, title: "Interdit" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(renameList(f.actorBruno, list.id, "Renommée")).rejects.toMatchObject({
      code: "forbidden",
    });

    // Promotion editor.
    await revokeGrant({ type: "task_list", id: list.id, orgId: f.orgId }, grant.id);
    await createGrant({
      resource: { type: "task_list", id: list.id, orgId: f.orgId },
      subject: { kind: "user", id: f.bruno },
      role: "editor",
      actor: f.actorAlice,
    });
    const created = await createTask(f.actorBruno, { listId: list.id, title: "Autorisé" });
    expect(created.title).toBe("Autorisé");

    // Éditeur ≠ propriétaire : la suppression de la liste reste réservée au propriétaire.
    await expect(deleteList(f.actorBruno, list.id)).rejects.toMatchObject({ code: "forbidden" });

    // Révocation : plus aucun accès.
    const grants = await listListGrants(f.actorAlice, list.id);
    for (const current of grants) await unshareList(f.actorAlice, list.id, current.id);
    expect(await listLists(f.actorBruno)).toHaveLength(0);
    await expect(listTasks(f.actorBruno, { listId: list.id })).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("le propriétaire supprime la liste et ses tâches en cascade", async () => {
    const list = await createList(f.actorAlice, { name: "Éphémère" });
    await createTask(f.actorAlice, { listId: list.id, title: "Éphémère aussi" });
    await deleteList(f.actorAlice, list.id);
    expect(await listLists(f.actorAlice)).toHaveLength(0);
  });
});

describe("tasks — « Mes tâches » transverses", () => {
  it("garde mes assignations et les tâches sans assigné des listes où j'ai l'écriture", async () => {
    const editorList = await createList(f.actorAlice, { name: "Partagée édition" });
    const viewerList = await createList(f.actorAlice, { name: "Partagée lecture" });
    const privateList = await createList(f.actorAlice, { name: "Privée Alice" });

    await shareList(f.actorAlice, editorList.id, {
      subject: { kind: "user", id: f.bruno },
      role: "editor",
    });
    await shareList(f.actorAlice, viewerList.id, {
      subject: { kind: "user", id: f.bruno },
      role: "viewer",
    });

    const assignedEditor = await createTask(f.actorAlice, {
      listId: editorList.id,
      title: "Assignée à moi (édition)",
      assigneeId: f.bruno,
    });
    const unassignedEditor = await createTask(f.actorAlice, {
      listId: editorList.id,
      title: "Sans assigné (édition)",
    });
    const assignedViewer = await createTask(f.actorAlice, {
      listId: viewerList.id,
      title: "Assignée à moi (lecture)",
      assigneeId: f.bruno,
    });
    await createTask(f.actorAlice, { listId: viewerList.id, title: "Sans assigné (lecture)" });
    await createTask(f.actorAlice, {
      listId: editorList.id,
      title: "Assignée à Alice",
      assigneeId: f.alice,
    });
    await createTask(f.actorAlice, { listId: privateList.id, title: "Invisible pour Bruno" });
    const doneMine = await createTask(f.actorAlice, {
      listId: editorList.id,
      title: "Terminée assignée à moi",
      assigneeId: f.bruno,
    });
    await updateTask(f.actorAlice, doneMine.id, { status: "done" });

    const rows = await listMyTasks(f.actorBruno);
    expect(rows.map((row) => row.task.id).sort()).toEqual(
      [assignedEditor.id, unassignedEditor.id, assignedViewer.id].sort(),
    );
    expect(rows.find((row) => row.task.id === assignedEditor.id)?.listName).toBe(
      "Partagée édition",
    );
    expect(rows.find((row) => row.task.id === assignedViewer.id)?.listName).toBe(
      "Partagée lecture",
    );
    expect(rows.some((row) => row.task.title === "Assignée à Alice")).toBe(false);
  });

  it("filtre par fenêtre : aujourd'hui, cette semaine, tout", async () => {
    const list = await createList(f.actorAlice, { name: "Fenêtres" });
    const now = Date.now();
    const past = await createTask(f.actorAlice, {
      listId: list.id,
      title: "En retard",
      assigneeId: f.alice,
      dueAt: new Date(now - 12 * 3_600_000).toISOString(),
    });
    const withinWeek = await createTask(f.actorAlice, {
      listId: list.id,
      title: "Cette semaine",
      assigneeId: f.alice,
      dueAt: new Date(now + 3 * 86_400_000).toISOString(),
    });
    const later = await createTask(f.actorAlice, {
      listId: list.id,
      title: "Plus tard",
      assigneeId: f.alice,
      dueAt: new Date(now + 8 * 86_400_000).toISOString(),
    });
    const noDue = await createTask(f.actorAlice, {
      listId: list.id,
      title: "Sans échéance",
      assigneeId: f.alice,
    });

    const today = await listMyTasks(f.actorAlice, { window: "today" });
    expect(today.map((row) => row.task.id)).toEqual([past.id]);

    const week = await listMyTasks(f.actorAlice, { window: "week" });
    expect(week.map((row) => row.task.id)).toEqual([past.id, withinWeek.id]);

    const all = await listMyTasks(f.actorAlice, { window: "all" });
    expect(all.map((row) => row.task.id)).toEqual([past.id, withinWeek.id, later.id, noDue.id]);
  });

  it("exclut les terminées et trie retards, priorité puis création", async () => {
    const list = await createList(f.actorAlice, { name: "Tri" });
    const now = Date.now();
    const overdueOld = await createTask(f.actorAlice, {
      listId: list.id,
      title: "Retard ancien",
      assigneeId: f.alice,
      priority: "medium",
      dueAt: new Date(now - 3 * 86_400_000).toISOString(),
    });
    const overdueRecent = await createTask(f.actorAlice, {
      listId: list.id,
      title: "Retard récent",
      assigneeId: f.alice,
      priority: "high",
      dueAt: new Date(now - 86_400_000).toISOString(),
    });
    const future = await createTask(f.actorAlice, {
      listId: list.id,
      title: "Futur",
      assigneeId: f.alice,
      priority: "low",
      dueAt: new Date(now + 2 * 86_400_000).toISOString(),
    });
    const sameDueHigh = await createTask(f.actorAlice, {
      listId: list.id,
      title: "Même échéance haute (1)",
      assigneeId: f.alice,
      priority: "high",
      dueAt: new Date(now + 5 * 86_400_000).toISOString(),
    });
    const tieFirst = await createTask(f.actorAlice, {
      listId: list.id,
      title: "Même échéance haute (2)",
      assigneeId: f.alice,
      priority: "high",
      dueAt: new Date(now + 5 * 86_400_000).toISOString(),
    });
    const tieSecond = await createTask(f.actorAlice, {
      listId: list.id,
      title: "Même échéance haute (3)",
      assigneeId: f.alice,
      priority: "high",
      dueAt: new Date(now + 5 * 86_400_000).toISOString(),
    });
    const sameDueLow = await createTask(f.actorAlice, {
      listId: list.id,
      title: "Même échéance basse",
      assigneeId: f.alice,
      priority: "low",
      dueAt: new Date(now + 5 * 86_400_000).toISOString(),
    });
    const highNoDue = await createTask(f.actorAlice, {
      listId: list.id,
      title: "Sans échéance haute",
      assigneeId: f.alice,
      priority: "high",
    });
    const lowNoDue = await createTask(f.actorAlice, {
      listId: list.id,
      title: "Sans échéance basse",
      assigneeId: f.alice,
      priority: "low",
    });
    const doneTask = await createTask(f.actorAlice, {
      listId: list.id,
      title: "Terminée très en retard",
      assigneeId: f.alice,
      dueAt: new Date(now - 10 * 86_400_000).toISOString(),
    });
    await updateTask(f.actorAlice, doneTask.id, { status: "done" });

    const rows = await listMyTasks(f.actorAlice);
    expect(rows.map((row) => row.task.id)).toEqual([
      overdueOld.id,
      overdueRecent.id,
      future.id,
      sameDueHigh.id,
      tieFirst.id,
      tieSecond.id,
      sameDueLow.id,
      highNoDue.id,
      lowNoDue.id,
    ]);
    expect(rows.map((row) => row.task.id)).not.toContain(doneTask.id);
  });

  it("borne la limite et répond vide sans liste visible", async () => {
    const list = await createList(f.actorAlice, { name: "Bornes" });
    for (let index = 0; index < 3; index += 1) {
      await createTask(f.actorAlice, {
        listId: list.id,
        title: `Tâche ${index}`,
        assigneeId: f.alice,
      });
    }

    const limited = await listMyTasks(f.actorAlice, { limit: 2 });
    expect(limited).toHaveLength(2);

    await expect(listMyTasks(f.actorAlice, { limit: 0 })).rejects.toMatchObject({
      code: "validation",
    });
    await expect(listMyTasks(f.actorAlice, { limit: 501 })).rejects.toMatchObject({
      code: "validation",
    });

    // Bruno ne voit aucune des listes d'Alice : agrégat vide, jamais d'erreur.
    expect(await listMyTasks(f.actorBruno)).toEqual([]);
  });
});

describe("tasks — audit", () => {
  it("journalise listes, tâches et partage", async () => {
    const list = await createList(f.actorAlice, { name: "Audit" });
    const task = await createTask(f.actorAlice, { listId: list.id, title: "Audit tâche" });
    const grant = await shareList(f.actorAlice, list.id, {
      subject: { kind: "user", id: f.bruno },
      role: "viewer",
    });
    if (!grant) throw new Error("Partage non créé.");
    await unshareList(f.actorAlice, list.id, grant.id);
    await deleteTask(f.actorAlice, task.id);
    await deleteList(f.actorAlice, list.id);

    const rows = await getDb().select().from(auditEvents).where(eq(auditEvents.orgId, f.orgId));
    const byAction = new Map(rows.map((row) => [row.action, row]));

    for (const action of ["tasks.list.create", "tasks.list.delete"]) {
      expect(byAction.get(action)).toMatchObject({
        actorUserId: f.actorAlice.userId,
        resourceType: "task_list",
        resourceId: list.id,
        result: "success",
      });
    }
    for (const action of ["tasks.list.share", "tasks.list.unshare"]) {
      expect(byAction.get(action)).toMatchObject({
        actorUserId: f.actorAlice.userId,
        resourceType: "task_list",
        resourceId: list.id,
        result: "success",
      });
    }
    for (const action of ["tasks.task.create", "tasks.task.delete"]) {
      expect(byAction.get(action)).toMatchObject({
        actorUserId: f.actorAlice.userId,
        resourceType: "task",
        resourceId: task.id,
        result: "success",
      });
    }
  });

  it("ne journalise pas les modifications de tâche (cases à cocher)", async () => {
    const list = await createList(f.actorAlice, { name: "Sans audit" });
    const task = await createTask(f.actorAlice, { listId: list.id, title: "Bascule" });

    const before = await countAuditRows(f.orgId);
    await updateTask(f.actorAlice, task.id, { status: "done" });
    await updateTask(f.actorAlice, task.id, { status: "todo", title: "Rebasculée" });
    expect(await countAuditRows(f.orgId)).toBe(before);
  });
});

describe("tasks — ordre du panneau des listes", () => {
  it("crée en fin de panneau et réordonne à la demande", async () => {
    const premiere = await createList(f.actorAlice, { name: "Première" });
    const deuxieme = await createList(f.actorAlice, { name: "Deuxième" });
    const troisieme = await createList(f.actorAlice, { name: "Troisième" });

    expect((await listLists(f.actorAlice)).map((entry) => entry.list.name)).toEqual([
      "Première",
      "Deuxième",
      "Troisième",
    ]);

    const ordered = await reorderLists(f.actorAlice, [troisieme.id, premiere.id, deuxieme.id]);
    expect(ordered.map((entry) => entry.list.id)).toEqual([troisieme.id, premiere.id, deuxieme.id]);
    // L'ordre est relu depuis la base : la position n'est pas qu'un affichage local.
    expect((await listLists(f.actorAlice)).map((entry) => entry.list.name)).toEqual([
      "Troisième",
      "Première",
      "Deuxième",
    ]);
  });

  it("refuse un ordre vide, en doublon, incomplet ou étranger", async () => {
    const list = await createList(f.actorAlice, { name: "Ordre" });
    const other = await createList(f.actorAlice, { name: "Autre" });

    await expect(reorderLists(f.actorAlice, [])).rejects.toMatchObject({ code: "validation" });
    await expect(reorderLists(f.actorAlice, [list.id, list.id])).rejects.toMatchObject({
      code: "validation",
    });
    await expect(reorderLists(f.actorAlice, [list.id])).rejects.toMatchObject({
      code: "validation",
    });
    await expect(
      reorderLists(f.actorAlice, [list.id, other.id, "00000000-0000-0000-0000-000000000000"]),
    ).rejects.toMatchObject({ code: "validation" });

    // Aucun des refus n'a bougé l'ordre existant.
    expect((await listLists(f.actorAlice)).map((entry) => entry.list.id)).toEqual([
      list.id,
      other.id,
    ]);
  });

  it("exige l'écriture sur chaque liste déplacée, isolation comprise", async () => {
    const shared = await createList(f.actorAlice, { name: "Partagée" });
    await shareList(f.actorAlice, shared.id, {
      subject: { kind: "user", id: f.bruno },
      role: "viewer",
    });
    const foreign = await createList(f.actorChloe, { name: "Chez Chloé" });

    await expect(reorderLists(f.actorBruno, [shared.id])).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(reorderLists(f.actorChloe, [foreign.id, shared.id])).rejects.toMatchObject({
      code: "validation",
    });

    // Promu éditeur, Bruno réordonne la liste partagée.
    for (const grant of await listListGrants(f.actorAlice, shared.id)) {
      await unshareList(f.actorAlice, shared.id, grant.id);
    }
    await createGrant({
      resource: { type: "task_list", id: shared.id, orgId: f.orgId },
      subject: { kind: "user", id: f.bruno },
      role: "editor",
      actor: f.actorAlice,
    });

    const ordered = await reorderLists(f.actorBruno, [shared.id]);
    expect(ordered.map((entry) => entry.list.id)).toEqual([shared.id]);
  });

  it("journalise la réorganisation sans bruit sur les autres actions", async () => {
    const list = await createList(f.actorAlice, { name: "Audit ordre" });
    const before = await countAuditRows(f.orgId);

    await reorderLists(f.actorAlice, [list.id]);

    const rows = await getDb().select().from(auditEvents).where(eq(auditEvents.orgId, f.orgId));
    expect(rows.length - before).toBe(1);
    expect(rows.at(-1)).toMatchObject({
      action: "tasks.list.reorder",
      resourceType: "task_list",
      result: "success",
    });
  });
});

describe("tasks — étiquettes", () => {
  it("crée, renomme, recolore puis supprime, dans l'ordre alphabétique", async () => {
    const zebre = await createLabel(f.actorAlice, { name: "Zèbre", color: "red" });
    const urgent = await createLabel(f.actorAlice, { name: "Urgent" });
    expect(urgent.color).toBe("blue");

    const rows = await listLabels(f.actorAlice);
    expect(rows.map((label) => label.name)).toEqual(["Urgent", "Zèbre"]);

    const renamed = await updateLabel(f.actorAlice, zebre.id, { name: "Zébu", color: "green" });
    expect(renamed.name).toBe("Zébu");
    expect(renamed.color).toBe("green");

    await expect(createLabel(f.actorAlice, { name: "Urgent" })).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(updateLabel(f.actorAlice, zebre.id, { name: "Urgent" })).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(
      createLabel(f.actorAlice, { name: "Turquoise", color: "turquoise" }),
    ).rejects.toMatchObject({
      code: "validation",
    });
    await expect(createLabel(f.actorAlice, { name: "  " })).rejects.toMatchObject({
      code: "validation",
    });

    await deleteLabel(f.actorAlice, zebre.id);
    expect((await listLabels(f.actorAlice)).map((label) => label.id)).toEqual([urgent.id]);
    await expect(deleteLabel(f.actorAlice, zebre.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("isole les étiquettes par organisation", async () => {
    await createLabel(f.actorAlice, { name: "Client" });
    const chezChloe = await createList(f.actorChloe, { name: "Chez Chloé" });
    expect(chezChloe.orgId).toBe(f.otherOrgId);

    expect(await listLabels(f.actorChloe)).toHaveLength(0);
    // Chloé a le droit d'écrire chez elle : le service refuse quand même, avant
    // toute recherche, parce que l'étiquette appartient à une autre organisation.
    await expect(
      updateLabel(f.actorChloe, "00000000-0000-0000-0000-000000000000", { name: "Vol" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("attache, remplace et vide les étiquettes d'une tâche", async () => {
    const list = await createList(f.actorAlice, { name: "Étiquettes" });
    const urgent = await createLabel(f.actorAlice, { name: "Urgent", color: "red" });
    const client = await createLabel(f.actorAlice, { name: "Client", color: "blue" });
    const perso = await createLabel(f.actorAlice, { name: "Perso", color: "green" });

    const task = await createTask(f.actorAlice, {
      listId: list.id,
      title: "Relire le dossier",
      labelIds: [urgent.id, client.id],
    });
    const rows = await listTasks(f.actorAlice, { listId: list.id });
    expect(rows[0]?.labels.map((label) => label.name)).toEqual(["Client", "Urgent"]);

    // Remplacement : « perso » remplace les deux précédentes.
    const attached = await setTaskLabels(f.actorAlice, task.id, [perso.id]);
    expect(attached.map((label) => label.id)).toEqual([perso.id]);

    // Mise à jour ordinaire : les étiquettes se vident aussi.
    await updateTask(f.actorAlice, task.id, { labelIds: [] });
    expect(await listTaskLabels(f.actorAlice, task.id)).toHaveLength(0);

    // Une étiquette étrangère à l'organisation est refusée.
    const foreign = await createLabel(f.actorChloe, { name: "Externe" });
    await expect(setTaskLabels(f.actorAlice, task.id, [foreign.id])).rejects.toMatchObject({
      code: "validation",
    });
    expect(await listTaskLabels(f.actorAlice, task.id)).toHaveLength(0);
  });

  it("supprime les liaisons en cascade sans toucher aux tâches", async () => {
    const list = await createList(f.actorAlice, { name: "Cascade" });
    const label = await createLabel(f.actorAlice, { name: "Perso" });
    const task = await createTask(f.actorAlice, {
      listId: list.id,
      title: "Arroser les plantes",
      labelIds: [label.id],
    });

    await deleteLabel(f.actorAlice, label.id);

    const rows = await listTasks(f.actorAlice, { listId: list.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(task.id);
    expect(rows[0]?.labels).toHaveLength(0);
  });

  it("réserve les étiquettes à l'organisation, partages de listes compris", async () => {
    const shared = await createList(f.actorAlice, { name: "Lecture seule" });
    await shareList(f.actorAlice, shared.id, {
      subject: { kind: "user", id: f.bruno },
      role: "viewer",
    });
    const label = await createLabel(f.actorAlice, { name: "Partagé" });

    // Un simple lecteur de liste voit la nomenclature : il en a besoin pour
    // lire une tâche étiquetée, et l'étiquette appartient à l'organisation.
    expect((await listLabels(f.actorBruno)).map((row) => row.id)).toEqual([label.id]);
    expect((await updateLabel(f.actorBruno, label.id, { name: "Commun" })).name).toBe("Commun");

    // Attacher une étiquette à une tâche reste soumis aux droits de la liste.
    const task = await createTask(f.actorAlice, { listId: shared.id, title: "Visible" });
    await expect(setTaskLabels(f.actorBruno, task.id, [label.id])).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(listTaskLabels(f.actorAlice, task.id)).resolves.toHaveLength(0);
  });
});

describe("tasks — sous-tâches (un seul niveau)", () => {
  it("crée, ordonne, compte puis supprime, bornes et isolation comprises", async () => {
    const list = await createList(f.actorAlice, { name: "Sous-tâches" });
    const task = await createTask(f.actorAlice, { listId: list.id, title: "Préparer le dossier" });

    const premiere = await createSubtask(f.actorAlice, { taskId: task.id, title: "Rassembler" });
    const deuxieme = await createSubtask(f.actorAlice, { taskId: task.id, title: "Relire" });
    const troisieme = await createSubtask(f.actorAlice, { taskId: task.id, title: "Envoyer" });

    expect([premiere.position, deuxieme.position, troisieme.position]).toEqual([0, 1, 2]);
    expect((await listSubtasks(f.actorAlice, task.id)).map((row) => row.title)).toEqual([
      "Rassembler",
      "Relire",
      "Envoyer",
    ]);

    // Réordonnancement simple : l'ordre est relu depuis la base.
    const reordonnees = await reorderSubtasks(f.actorAlice, task.id, [
      troisieme.id,
      premiere.id,
      deuxieme.id,
    ]);
    expect(reordonnees.map((row) => row.title)).toEqual(["Envoyer", "Rassembler", "Relire"]);

    // Les compteurs voyagent avec la tâche, sans requête supplémentaire visible.
    const [fromList] = await listTasks(f.actorAlice, { listId: list.id });
    expect([fromList?.subtaskTotal, fromList?.subtaskDone]).toEqual([3, 0]);
    expect(await countSubtasks(f.actorAlice, task.id)).toEqual({ total: 3, done: 0 });

    await deleteSubtask(f.actorAlice, deuxieme.id);
    expect(await countSubtasks(f.actorAlice, task.id)).toEqual({ total: 2, done: 0 });

    // Titres invalides : vide, caractère de contrôle, trop long.
    await expect(
      createSubtask(f.actorAlice, { taskId: task.id, title: "   " }),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(
      createSubtask(f.actorAlice, { taskId: task.id, title: "a\nb" }),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(
      createSubtask(f.actorAlice, { taskId: task.id, title: "z".repeat(201) }),
    ).rejects.toMatchObject({ code: "validation" });

    // Isolation : la sous-tâche d'une autre organisation est introuvable.
    await expect(updateSubtask(f.actorChloe, premiere.id, { title: "Vol" })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("termine la tâche parente quand tout est fait, la rouvre sinon", async () => {
    const list = await createList(f.actorAlice, { name: "Progression" });
    const task = await createTask(f.actorAlice, { listId: list.id, title: "Grande tâche" });
    const a = await createSubtask(f.actorAlice, { taskId: task.id, title: "Étape 1" });
    const b = await createSubtask(f.actorAlice, { taskId: task.id, title: "Étape 2" });

    await updateSubtask(f.actorAlice, a.id, { isDone: true });
    let [row] = await listTasks(f.actorAlice, { listId: list.id });
    expect(row?.status).toBe("todo");
    expect(row?.subtaskDone).toBe(1);

    await updateSubtask(f.actorAlice, b.id, { isDone: true });
    [row] = await listTasks(f.actorAlice, { listId: list.id });
    expect(row?.status).toBe("done");
    expect(row?.completedAt).not.toBeNull();
    expect(row?.subtaskDone).toBe(2);

    // Rouvrir une sous-tâche rouvre la tâche parente.
    await updateSubtask(f.actorAlice, a.id, { isDone: false });
    [row] = await listTasks(f.actorAlice, { listId: list.id });
    expect(row?.status).toBe("todo");
    expect(row?.completedAt).toBeNull();
  });

  it("supprime les sous-tâches en cascade avec la tâche", async () => {
    const list = await createList(f.actorAlice, { name: "Cascade sous-tâches" });
    const task = await createTask(f.actorAlice, { listId: list.id, title: "Éphémère" });
    await createSubtask(f.actorAlice, { taskId: task.id, title: "Bribe" });

    await deleteTask(f.actorAlice, task.id);

    const rows = await getDb().select().from(taskSubtasks).where(eq(taskSubtasks.taskId, task.id));
    expect(rows).toHaveLength(0);
  });

  it("réserve l'écriture à la liste, ordre complet exigé", async () => {
    const list = await createList(f.actorAlice, { name: "Droits sous-tâches" });
    const task = await createTask(f.actorAlice, { listId: list.id, title: "Visible" });
    const a = await createSubtask(f.actorAlice, { taskId: task.id, title: "A" });
    const other = await createSubtask(f.actorAlice, { taskId: task.id, title: "B" });

    await shareList(f.actorAlice, list.id, {
      subject: { kind: "user", id: f.bruno },
      role: "viewer",
    });
    await expect(
      createSubtask(f.actorBruno, { taskId: task.id, title: "Interdit" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await listSubtasks(f.actorBruno, task.id)).toHaveLength(2);

    await expect(reorderSubtasks(f.actorAlice, task.id, [])).rejects.toMatchObject({
      code: "validation",
    });
    await expect(reorderSubtasks(f.actorAlice, task.id, [a.id, a.id])).rejects.toMatchObject({
      code: "validation",
    });
    await expect(reorderSubtasks(f.actorAlice, task.id, [a.id])).rejects.toMatchObject({
      code: "validation",
    });
    await expect(
      reorderSubtasks(f.actorAlice, task.id, [
        a.id,
        other.id,
        "00000000-0000-0000-0000-000000000000",
      ]),
    ).rejects.toMatchObject({ code: "validation" });
    expect(await listSubtasks(f.actorAlice, task.id)).toHaveLength(2);
  });
});

describe("tasks — ordre manuel des tâches", () => {
  it("persiste l'ordre glissé, sans toucher à l'ordre par défaut", async () => {
    const list = await createList(f.actorAlice, { name: "Ordre manuel" });
    const a = await createTask(f.actorAlice, { listId: list.id, title: "A" });
    const b = await createTask(f.actorAlice, { listId: list.id, title: "B" });
    const c = await createTask(f.actorAlice, { listId: list.id, title: "C" });

    const manualIds = async () =>
      (await listTasks(f.actorAlice, { listId: list.id, order: "manual" })).map((row) => row.id);

    expect(await manualIds()).toEqual([a.id, b.id, c.id]);

    await reorderTasks(f.actorAlice, list.id, [c.id, a.id, b.id]);
    expect(await manualIds()).toEqual([c.id, a.id, b.id]);
    // L'ordre par défaut reste piloté par l'échéance et la création.
    expect((await listTasks(f.actorAlice, { listId: list.id })).map((row) => row.id)).toEqual([
      a.id,
      b.id,
      c.id,
    ]);

    // Une nouvelle tâche se range en fin d'ordre manuel.
    const d = await createTask(f.actorAlice, { listId: list.id, title: "D" });
    expect(await manualIds()).toEqual([c.id, a.id, b.id, d.id]);
  });

  it("refuse un ordre vide, en doublon, incomplet ou étranger, et exige l'écriture", async () => {
    const list = await createList(f.actorAlice, { name: "Ordre strict" });
    const a = await createTask(f.actorAlice, { listId: list.id, title: "A" });
    const b = await createTask(f.actorAlice, { listId: list.id, title: "B" });

    await expect(reorderTasks(f.actorAlice, list.id, [])).rejects.toMatchObject({
      code: "validation",
    });
    await expect(reorderTasks(f.actorAlice, list.id, [a.id, a.id])).rejects.toMatchObject({
      code: "validation",
    });
    await expect(reorderTasks(f.actorAlice, list.id, [a.id])).rejects.toMatchObject({
      code: "validation",
    });
    await expect(
      reorderTasks(f.actorAlice, list.id, [a.id, b.id, "00000000-0000-0000-0000-000000000000"]),
    ).rejects.toMatchObject({ code: "validation" });
    expect(
      (await listTasks(f.actorAlice, { listId: list.id, order: "manual" })).map((row) => row.id),
    ).toEqual([a.id, b.id]);

    await shareList(f.actorAlice, list.id, {
      subject: { kind: "user", id: f.bruno },
      role: "viewer",
    });
    await expect(reorderTasks(f.actorBruno, list.id, [b.id, a.id])).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("journalise la réorganisation des tâches", async () => {
    const list = await createList(f.actorAlice, { name: "Audit ordre tâches" });
    const a = await createTask(f.actorAlice, { listId: list.id, title: "A" });
    const b = await createTask(f.actorAlice, { listId: list.id, title: "B" });
    const before = await countAuditRows(f.orgId);

    await reorderTasks(f.actorAlice, list.id, [b.id, a.id]);

    expect(await countAuditRows(f.orgId)).toBe(before + 1);
    const rows = await getDb().select().from(auditEvents).where(eq(auditEvents.orgId, f.orgId));
    expect(rows.at(-1)).toMatchObject({
      action: "tasks.task.reorder",
      resourceType: "task_list",
      resourceId: list.id,
      result: "success",
    });
  });
});
