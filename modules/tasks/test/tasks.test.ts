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
    await revokeGrant(grant!.id);
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
