import { randomUUID } from "node:crypto";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFolder, ensureFolder, listSyncTree, shareEntry, uploadFile } from "../src/index.ts";

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

describe("drive — synchronisation", () => {
  it("retourne un instantané plat des éléments lisibles", async () => {
    const folder = await createFolder(f.actorAlice, { name: "Projets" });
    const file = await uploadFile(f.actorAlice, {
      parentId: folder.id,
      name: "notes.txt",
      contentType: "text/plain",
      body: Buffer.from("bonjour"),
    });

    const tree = await listSyncTree(f.actorAlice);
    const folderEntry = tree.find((entry) => entry.id === folder.id);
    const fileEntry = tree.find((entry) => entry.id === file.entry.id);

    expect(folderEntry).toMatchObject({ kind: "folder", name: "Projets", parentId: null });
    expect(fileEntry).toMatchObject({
      kind: "file",
      name: "notes.txt",
      parentId: folder.id,
    });
    expect(fileEntry?.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("ne montre rien à un autre membre sans partage, puis suit le grant hérité", async () => {
    const folder = await createFolder(f.actorAlice, { name: "Partagé" });
    await uploadFile(f.actorAlice, {
      parentId: folder.id,
      name: "a.txt",
      contentType: "text/plain",
      body: Buffer.from("a"),
    });

    expect(await listSyncTree(f.actorBruno)).toHaveLength(0);

    await shareEntry(f.actorAlice, folder.id, {
      subject: { kind: "user", id: f.bruno },
      role: "viewer",
    });

    const brunoTree = await listSyncTree(f.actorBruno);
    expect(brunoTree.some((entry) => entry.id === folder.id)).toBe(true);
    expect(brunoTree.some((entry) => entry.name === "a.txt")).toBe(true);
  });

  it("isole les organisations", async () => {
    await createFolder(f.actorAlice, { name: "Privé" });
    expect(await listSyncTree(f.actorChloe)).toHaveLength(0);
  });

  it("crée un dossier de façon idempotente", async () => {
    const first = await ensureFolder(f.actorAlice, { name: "Sync" });
    const second = await ensureFolder(f.actorAlice, { name: "Sync" });
    expect(second.id).toBe(first.id);
  });

  it("refuse de remplacer un fichier par un dossier", async () => {
    await uploadFile(f.actorAlice, {
      name: "conflit.txt",
      contentType: "text/plain",
      body: Buffer.from("x"),
    });

    await expect(ensureFolder(f.actorAlice, { name: "conflit.txt" })).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("refuse un parent d'une autre organisation", async () => {
    const folder = await createFolder(f.actorAlice, { name: "Alice" });
    await expect(
      ensureFolder(f.actorChloe, { parentId: folder.id, name: "Intrusion" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
