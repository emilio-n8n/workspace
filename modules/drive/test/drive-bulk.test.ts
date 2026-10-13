import { randomUUID } from "node:crypto";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFolder,
  createTextFile,
  listEntries,
  listMoveTargets,
  moveEntries,
  trashEntries,
} from "../src/index.ts";
import { driveFiles } from "../src/schema.ts";

const { user, organization } = coreSchema;

let counter = 0;
const tag = (prefix: string) => `${prefix}${++counter}_${randomUUID().slice(0, 8)}`;

type Fixtures = {
  orgId: string;
  otherOrgId: string;
  alice: string;
  bruno: string;
  actorAlice: Actor;
  actorBruno: Actor;
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

  return {
    orgId,
    otherOrgId,
    alice,
    bruno,
    actorAlice: { userId: alice, orgId },
    actorBruno: { userId: bruno, orgId },
  };
}

async function cleanup(f: Fixtures): Promise<void> {
  const db = getDb();
  await db.delete(organization).where(eq(organization.id, f.orgId));
  await db.delete(organization).where(eq(organization.id, f.otherOrgId));
  for (const id of [f.alice, f.bruno]) await db.delete(user).where(eq(user.id, id));
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

/** Parent effectif d'une entrée, lu directement en base. */
async function parentOf(entryId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ parentId: driveFiles.parentId })
    .from(driveFiles)
    .where(eq(driveFiles.id, entryId))
    .limit(1);
  return row?.parentId ?? null;
}

describe("drive — déplacement groupé", () => {
  it("déplace plusieurs fichiers vers un dossier de destination", async () => {
    const cible = await createFolder(f.actorAlice, { name: "Cible" });
    const a = await createTextFile(f.actorAlice, { name: "a.txt", content: "a" });
    const b = await createTextFile(f.actorAlice, { name: "b.txt", content: "b" });

    const result = await moveEntries(f.actorAlice, {
      entryIds: [a.id, b.id],
      targetParentId: cible.id,
    });

    expect(result.moved).toEqual([a.id, b.id]);
    expect(result.failures).toEqual([]);
    expect(await parentOf(a.id)).toBe(cible.id);
    expect(await parentOf(b.id)).toBe(cible.id);

    const dansCible = await listEntries(f.actorAlice, { parentId: cible.id });
    expect(dansCible.map((row) => row.name).sort()).toEqual(["a.txt", "b.txt"]);
    expect((await listEntries(f.actorAlice)).map((row) => row.name)).toEqual(["Cible"]);
  });

  it("déplace à la racine quand la cible est nulle", async () => {
    const dossier = await createFolder(f.actorAlice, { name: "Cible" });
    const a = await createTextFile(f.actorAlice, {
      parentId: dossier.id,
      name: "a.txt",
      content: "a",
    });

    const result = await moveEntries(f.actorAlice, {
      entryIds: [a.id],
      targetParentId: null,
    });

    expect(result.moved).toEqual([a.id]);
    expect(await parentOf(a.id)).toBeNull();
  });

  it("dédoublonne les identifiants et borne la taille du lot", async () => {
    const cible = await createFolder(f.actorAlice, { name: "Cible" });
    const a = await createTextFile(f.actorAlice, { name: "a.txt", content: "a" });

    const result = await moveEntries(f.actorAlice, {
      entryIds: [a.id, a.id, a.id],
      targetParentId: cible.id,
    });

    expect(result.moved).toEqual([a.id]);
    expect(result.failures).toEqual([]);
  });

  it("ne fait rien — et ne l'annonce pas comme un échec — si la liste est vide", async () => {
    const result = await moveEntries(f.actorAlice, { entryIds: [], targetParentId: null });
    expect(result).toEqual({ targetParentId: null, moved: [], failures: [] });
  });

  it("refuse de déplacer un dossier dans sa propre descendance", async () => {
    const parent = await createFolder(f.actorAlice, { name: "Parent" });
    const enfant = await createFolder(f.actorAlice, { parentId: parent.id, name: "Enfant" });

    await expect(
      moveEntries(f.actorAlice, { entryIds: [parent.id], targetParentId: enfant.id }),
    ).rejects.toMatchObject({ name: "DriveError", code: "validation" });

    // Le déplacement d'un dossier dans lui-même est refusé pour la même raison.
    await expect(
      moveEntries(f.actorAlice, { entryIds: [parent.id], targetParentId: parent.id }),
    ).rejects.toMatchObject({ name: "DriveError", code: "validation" });

    expect(await parentOf(enfant.id)).toBe(parent.id);
  });

  it("accepte de déplacer un dossier avec son contenu vers un autre dossier", async () => {
    const cible = await createFolder(f.actorAlice, { name: "Cible" });
    const source = await createFolder(f.actorAlice, { name: "Source" });
    const dedans = await createTextFile(f.actorAlice, {
      parentId: source.id,
      name: "dedans.txt",
      content: "x",
    });

    const result = await moveEntries(f.actorAlice, {
      entryIds: [source.id],
      targetParentId: cible.id,
    });

    expect(result.moved).toEqual([source.id]);
    expect(await parentOf(source.id)).toBe(cible.id);
    // Le contenu suit son dossier, sans être touché.
    expect(await parentOf(dedans.id)).toBe(source.id);
  });

  it("signale un conflit de nom sans annuler les autres déplacements", async () => {
    const cible = await createFolder(f.actorAlice, { name: "Cible" });
    await createTextFile(f.actorAlice, { parentId: cible.id, name: "doublon.txt", content: "x" });
    const doublon = await createTextFile(f.actorAlice, { name: "doublon.txt", content: "y" });
    const autre = await createTextFile(f.actorAlice, { name: "autre.txt", content: "z" });

    const result = await moveEntries(f.actorAlice, {
      entryIds: [doublon.id, autre.id],
      targetParentId: cible.id,
    });

    expect(result.moved).toEqual([autre.id]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.id).toBe(doublon.id);
    expect(result.failures[0]?.message).toContain("doublon.txt");
    expect(await parentOf(autre.id)).toBe(cible.id);
    expect(await parentOf(doublon.id)).toBeNull();
  });

  it("isole un élément introuvable du reste du lot", async () => {
    const cible = await createFolder(f.actorAlice, { name: "Cible" });
    const a = await createTextFile(f.actorAlice, { name: "a.txt", content: "a" });

    const result = await moveEntries(f.actorAlice, {
      entryIds: [a.id, randomUUID()],
      targetParentId: cible.id,
    });

    expect(result.moved).toEqual([a.id]);
    expect(result.failures[0]?.message).toBe("Élément introuvable.");
  });

  it("refuse de déplacer un élément dans la corbeille", async () => {
    const cible = await createFolder(f.actorAlice, { name: "Cible" });
    const a = await createTextFile(f.actorAlice, { name: "a.txt", content: "a" });
    await trashEntries(f.actorAlice, { entryIds: [a.id] });

    const result = await moveEntries(f.actorAlice, { entryIds: [a.id], targetParentId: cible.id });

    expect(result.moved).toEqual([]);
    expect(result.failures[0]?.message).toContain("corbeille");
  });

  it("refuse une cible qui n'est pas un dossier", async () => {
    const fichier = await createTextFile(f.actorAlice, { name: "a.txt", content: "a" });
    const a = await createTextFile(f.actorAlice, { name: "b.txt", content: "b" });

    await expect(
      moveEntries(f.actorAlice, { entryIds: [a.id], targetParentId: fichier.id }),
    ).rejects.toMatchObject({ name: "DriveError", code: "validation" });
  });

  it("refuse un élément dont l'acteur n'a pas le droit d'écriture", async () => {
    // Bruno n'est ni propriétaire ni destinataire d'un grant sur cet élément.
    const a = await createTextFile(f.actorAlice, { name: "a.txt", content: "a" });

    const result = await moveEntries(f.actorBruno, { entryIds: [a.id], targetParentId: null });

    expect(result.moved).toEqual([]);
    expect(result.failures[0]?.message).toContain("Permission insuffisante");
    expect(await parentOf(a.id)).toBeNull();
  });
});

describe("drive — cibles de déplacement", () => {
  it("propose les dossiers accessibles en écriture, triés par nom", async () => {
    await createFolder(f.actorAlice, { name: "Zèbre" });
    await createFolder(f.actorAlice, { name: "Agenda" });
    // Les fichiers ne sont jamais des cibles.
    await createTextFile(f.actorAlice, { name: "notes.txt", content: "x" });

    const noms = (await listMoveTargets(f.actorAlice)).map((row) => row.name);
    expect(noms).toEqual(["Agenda", "Zèbre"]);
  });

  it("écarte les éléments déplacés et leurs descendants", async () => {
    const source = await createFolder(f.actorAlice, { name: "Source" });
    const enfant = await createFolder(f.actorAlice, { parentId: source.id, name: "Enfant" });
    const petitEnfant = await createFolder(f.actorAlice, {
      parentId: enfant.id,
      name: "Petit-enfant",
    });
    const autre = await createFolder(f.actorAlice, { name: "Autre" });

    const cibles = await listMoveTargets(f.actorAlice, { excludeIds: [source.id] });
    const ids = cibles.map((row) => row.id);

    expect(ids).toContain(autre.id);
    expect(ids).not.toContain(source.id);
    expect(ids).not.toContain(enfant.id);
    expect(ids).not.toContain(petitEnfant.id);
  });

  it("ne dépend pas des dossiers d'une autre organisation", async () => {
    await createFolder(f.actorAlice, { name: "Alice" });
    await createFolder(f.actorBruno, { name: "Bruno" });

    const noms = (await listMoveTargets(f.actorAlice)).map((row) => row.name);
    expect(noms).toEqual(["Alice"]);
  });
});

describe("drive — corbeille groupée", () => {
  it("met une sélection entière à la corbeille", async () => {
    const a = await createTextFile(f.actorAlice, { name: "a.txt", content: "a" });
    const dossier = await createFolder(f.actorAlice, { name: "Dossier" });
    const dedans = await createTextFile(f.actorAlice, {
      parentId: dossier.id,
      name: "dedans.txt",
      content: "x",
    });

    const result = await trashEntries(f.actorAlice, { entryIds: [a.id, dossier.id] });

    expect(result.trashed).toEqual([a.id, dossier.id]);
    expect(result.failures).toEqual([]);
    expect(await listEntries(f.actorAlice)).toEqual([]);
    // Le sous-arbre suit son dossier.
    const [intact] = await getDb()
      .select({ status: driveFiles.status })
      .from(driveFiles)
      .where(and(eq(driveFiles.id, dedans.id), eq(driveFiles.orgId, f.orgId)))
      .limit(1);
    expect(intact?.status).toBe("trashed");
  });

  it("isole un élément introuvable du reste du lot", async () => {
    const a = await createTextFile(f.actorAlice, { name: "a.txt", content: "a" });

    const result = await trashEntries(f.actorAlice, { entryIds: [a.id, randomUUID()] });

    expect(result.trashed).toEqual([a.id]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.id).not.toBe(a.id);
  });

  it("ne touche pas aux éléments dont l'acteur n'a pas les droits", async () => {
    const a = await createTextFile(f.actorAlice, { name: "a.txt", content: "a" });

    const result = await trashEntries(f.actorBruno, { entryIds: [a.id] });

    expect(result.trashed).toEqual([]);
    expect(result.failures[0]?.id).toBe(a.id);
    expect((await listEntries(f.actorAlice)).map((row) => row.id)).toEqual([a.id]);
  });
});
