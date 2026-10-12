import { randomUUID } from "node:crypto";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import { type Actor, createGrant, revokeGrant } from "@workspace/permissions";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createList,
  createTask,
  deleteList,
  deleteTask,
  effectiveListRole,
  listListGrants,
  listLists,
  listMyTasks,
  listTasks,
  renameList,
  shareList,
  TasksError,
  unshareList,
  updateTask,
} from "../src/index.ts";

const { user, organization } = coreSchema;

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
  await db.delete(organization).where(eq(organization.id, f.orgId));
  await db.delete(organization).where(eq(organization.id, f.otherOrgId));
  for (const id of [f.alice, f.bruno, f.chloe]) await db.delete(user).where(eq(user.id, id));
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
