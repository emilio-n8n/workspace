import { randomUUID } from "node:crypto";
import { createEvent } from "@workspace/calendar";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import { uploadFile } from "@workspace/drive";
import { createForm } from "@workspace/forms";
import type { Actor } from "@workspace/permissions";
import { createList, createTask } from "@workspace/tasks";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { SearchError, searchEverything } from "../src/index.ts";

const { user, organization, member } = coreSchema;

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

  // Alice et Bruno sont membres de la même organisation ; Chloe est ailleurs.
  await db.insert(member).values([
    { id: tag("mem"), organizationId: orgId, userId: alice, role: "owner", createdAt: now },
    { id: tag("mem"), organizationId: orgId, userId: bruno, role: "member", createdAt: now },
    {
      id: tag("mem"),
      organizationId: otherOrgId,
      userId: chloe,
      role: "owner",
      createdAt: now,
    },
  ]);

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
  // La suppression des organisations cascade sur les tables des modules.
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

type Content = {
  fileId: string;
  formFileId: string;
  taskId: string;
  eventId: string;
};

/** Contenu de test : un fichier, un formulaire, une tâche et un événement « Plan… ». */
async function createContent(): Promise<Content> {
  const { entry } = await uploadFile(f.actorAlice, {
    name: "Plan de lancement.pdf",
    contentType: "application/pdf",
    body: Buffer.from("contenu de test — plan de lancement", "utf8"),
  });

  const { entry: formEntry } = await createForm(f.actorAlice, { title: "Plan d'enquête" });

  const list = await createList(f.actorAlice, { name: "Projet Plan" });
  const task = await createTask(f.actorAlice, {
    listId: list.id,
    title: "Planifier la réunion",
  });

  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const event = await createEvent(f.actorAlice, {
    title: "Plan annuel",
    description: "Revue du plan de lancement",
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000).toISOString(),
  });

  return { fileId: entry.id, formFileId: formEntry.id, taskId: task.id, eventId: event.id };
}

describe("search — recherche globale (services composés)", () => {
  it("trouve les quatre familles par préfixe partiel et les classe par famille", async () => {
    const content = await createContent();

    const results = await searchEverything(f.actorAlice, { query: "pl" });

    const file = results.find((result) => result.kind === "file" && result.id === content.fileId);
    expect(file).toMatchObject({
      id: content.fileId,
      appId: "drive",
      title: "Plan de lancement.pdf",
      subtitle: "PDF",
    });

    const form = results.find((result) => result.kind === "form");
    expect(form).toMatchObject({
      id: content.formFileId,
      appId: "forms",
      title: "Plan d'enquête",
      subtitle: "Formulaire · 0 réponse(s)",
    });

    const task = results.find((result) => result.kind === "task");
    expect(task).toMatchObject({
      id: content.taskId,
      appId: "tasks",
      title: "Planifier la réunion",
      subtitle: "Liste « Projet Plan » · À faire",
    });

    const event = results.find((result) => result.kind === "event");
    expect(event).toMatchObject({
      id: content.eventId,
      appId: "calendar",
      title: "Plan annuel",
    });
    expect(event?.subtitle).toContain("Mon agenda");

    // L'ordre des familles suit file → form → task → event.
    const kinds = results.map((result) => result.kind);
    expect(kinds.indexOf("file")).toBe(0);
    expect(kinds.indexOf("file")).toBeLessThan(kinds.indexOf("form"));
    expect(kinds.indexOf("form")).toBeLessThan(kinds.indexOf("task"));
    expect(kinds.indexOf("task")).toBeLessThan(kinds.indexOf("event"));
  });

  it("ignore la casse et les espaces autour de la requête", async () => {
    await createContent();

    const results = await searchEverything(f.actorAlice, { query: "  PLAN  " });
    const kinds = new Set(results.map((result) => result.kind));
    expect(kinds).toContain("file");
    expect(kinds).toContain("form");
    expect(kinds).toContain("task");
    expect(kinds).toContain("event");
  });

  it("applique la limite demandée (la plus pertinente d'abord)", async () => {
    await createContent();

    const one = await searchEverything(f.actorAlice, { query: "pl", limit: 1 });
    expect(one).toHaveLength(1);
    expect(one[0]?.kind).toBe("file");

    const all = await searchEverything(f.actorAlice, { query: "pl" });
    expect(all.length).toBeGreaterThan(one.length);
  });

  it("refuse les requêtes trop courtes ou trop longues", async () => {
    await expect(searchEverything(f.actorAlice, { query: "a" })).rejects.toBeInstanceOf(
      SearchError,
    );
    await expect(searchEverything(f.actorAlice, { query: " x " })).rejects.toMatchObject({
      code: "validation",
    });
    await expect(searchEverything(f.actorAlice, { query: "x".repeat(101) })).rejects.toMatchObject({
      code: "validation",
    });
  });

  it("isole les organisations : l'autre org ne trouve rien", async () => {
    await createContent();

    expect(await searchEverything(f.actorChloe, { query: "pl" })).toEqual([]);
    expect(await searchEverything(f.actorChloe, { query: "plan" })).toEqual([]);
    // Bruno est membre de l'org mais sans partage : aucun contenu visible.
    expect(await searchEverything(f.actorBruno, { query: "pl" })).toEqual([]);
  });
});
