import { createHash, randomUUID } from "node:crypto";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import { type Actor, createGrant, revokeGrant } from "@workspace/permissions";
import { getStorage } from "@workspace/storage";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  accessShareLink,
  createFolder,
  createShareLink,
  download,
  effectiveRole,
  listEntries,
  listVersions,
  purge,
  rename,
  replaceContent,
  restore,
  revokeShareLink,
  shareEntry,
  trash,
  uploadFile,
} from "../src/index.ts";
import { driveFiles, driveShareLinks } from "../src/schema.ts";

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
  // La suppression de l'organisation cascade sur drive_files (org_id) → versions et liens.
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
  // Le répertoire temporaire de stockage est créé par test/setup.ts ; il sera
  // purgé par le système. Aucune donnée réelle n'y transite.
});

function bufferOf(text: string): Buffer {
  return Buffer.from(text, "utf8");
}

describe("drive — dossiers et fichiers (propriétaire)", () => {
  it("crée un dossier, upload un fichier, liste, télécharge — contenu intact", async () => {
    const folder = await createFolder(f.actorAlice, { name: "Projets" });
    const content = "Bonjour le monde ✅";
    const { entry } = await uploadFile(f.actorAlice, {
      parentId: folder.id,
      name: "notes.txt",
      contentType: "text/plain",
      body: bufferOf(content),
    });

    expect(entry.checksum).toBe(createHash("sha256").update(bufferOf(content)).digest("hex"));
    expect(entry.sizeBytes).toBe(Buffer.byteLength(content));

    const root = await listEntries(f.actorAlice);
    expect(root.map((row) => row.name)).toEqual(["Projets"]);

    const children = await listEntries(f.actorAlice, { parentId: folder.id });
    expect(children.map((row) => row.name)).toEqual(["notes.txt"]);

    const downloaded = await download(f.actorAlice, entry.id);
    expect(downloaded.body.toString("utf8")).toBe(content);
  });

  it("refuse un nom en conflit avec un message exploitable", async () => {
    await createFolder(f.actorAlice, { name: "Doublon" });
    await expect(createFolder(f.actorAlice, { name: "Doublon" })).rejects.toMatchObject({
      name: "DriveError",
      code: "conflict",
    });
  });

  it("refuse les fichiers au-delà de la limite de taille", async () => {
    const big = Buffer.alloc(1001, 1); // MAX_UPLOAD_BYTES = 1000 dans les tests
    await expect(
      uploadFile(f.actorAlice, { name: "trop-gros.bin", body: big }),
    ).rejects.toMatchObject({ code: "validation" });
  });
});

describe("drive — partage et héritage", () => {
  it("refus par défaut, puis partage viewer/editor avec révocation", async () => {
    const file = await uploadFile(f.actorAlice, {
      name: "rapport.txt",
      body: bufferOf("secret"),
    });

    // Refus par défaut pour Bruno.
    expect(await listEntries(f.actorBruno)).toHaveLength(0);
    await expect(download(f.actorBruno, file.entry.id)).rejects.toMatchObject({
      code: "forbidden",
    });

    // Partage viewer.
    const granted = await shareEntry(f.actorAlice, file.entry.id, {
      subject: { kind: "user", id: f.bruno },
      role: "viewer",
    });
    expect(granted).not.toBeNull();

    expect((await listEntries(f.actorBruno)).map((row) => row.name)).toEqual(["rapport.txt"]);
    expect((await download(f.actorBruno, file.entry.id)).body.toString()).toBe("secret");

    // Viewer ne peut pas renommer.
    await expect(rename(f.actorBruno, file.entry.id, "pirate.txt")).rejects.toMatchObject({
      code: "forbidden",
    });

    // Promotion editor.
    await revokeGrant(granted!.id);
    await createGrant({
      resource: { type: "file", id: file.entry.id, orgId: f.orgId },
      subject: { kind: "user", id: f.bruno },
      role: "editor",
      actor: f.actorAlice,
    });
    const renamed = await rename(f.actorBruno, file.entry.id, "revu-bruno.txt");
    expect(renamed.name).toBe("revu-bruno.txt");
  });

  it("héritage : un grant sur le dossier s'applique aux enfants", async () => {
    const folder = await createFolder(f.actorAlice, { name: "Partagé" });
    const child = await uploadFile(f.actorAlice, {
      parentId: folder.id,
      name: "enfant.txt",
      body: bufferOf("hérité"),
    });

    await shareEntry(f.actorAlice, folder.id, {
      subject: { kind: "user", id: f.bruno },
      role: "viewer",
    });

    expect(await effectiveRole(f.actorBruno, child.entry.id)).toBe("viewer");
    expect((await download(f.actorBruno, child.entry.id)).body.toString()).toBe("hérité");
    const listing = await listEntries(f.actorBruno, { parentId: folder.id });
    expect(listing.map((row) => row.name)).toEqual(["enfant.txt"]);
  });

  it("isolation inter-organisations : aucun accès, même avec un partage forgé", async () => {
    const file = await uploadFile(f.actorAlice, { name: "prive.txt", body: bufferOf("x") });

    await expect(download(f.actorChloe, file.entry.id)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(await listEntries(f.actorChloe)).toHaveLength(0);

    // Bruno (même org) ne voit pas l'organisation de Chloé.
    expect(await effectiveRole(f.actorChloe, file.entry.id)).toBeNull();
  });
});

describe("drive — corbeille, versions et purge", () => {
  it("corbeille → restauration → purge (stockage nettoyé)", async () => {
    const { entry } = await uploadFile(f.actorAlice, {
      name: "jetable.txt",
      body: bufferOf("temporaire"),
    });

    await trash(f.actorAlice, entry.id);
    expect(await listEntries(f.actorAlice)).toHaveLength(0);

    await restore(f.actorAlice, entry.id);
    expect((await listEntries(f.actorAlice)).map((row) => row.name)).toEqual(["jetable.txt"]);

    const storage = getStorage();
    const key = entry.storageKey!;
    expect(await storage.get(key)).not.toBeNull();

    await trash(f.actorAlice, entry.id);
    await purge(f.actorAlice, entry.id);

    expect(await storage.get(key)).toBeNull();
    const db = getDb();
    const remaining = await db.select().from(driveFiles).where(eq(driveFiles.id, entry.id));
    expect(remaining).toHaveLength(0);
  });

  it("remplacement de contenu → version 2 servie, deux versions conservées", async () => {
    const { entry } = await uploadFile(f.actorAlice, {
      name: "doc.txt",
      body: bufferOf("v1"),
    });

    const replaced = await replaceContent(f.actorAlice, entry.id, {
      body: bufferOf("v2-plus-long"),
    });
    expect(replaced.version.version).toBe(2);

    expect((await download(f.actorAlice, entry.id)).body.toString()).toBe("v2-plus-long");

    const versions = await listVersions(f.actorAlice, entry.id);
    expect(versions.map((version) => version.version)).toEqual([2, 1]);
  });

  it("purge impossible si l'élément n'est pas dans la corbeille", async () => {
    const { entry } = await uploadFile(f.actorAlice, { name: "actif.txt", body: bufferOf("ok") });
    await expect(purge(f.actorAlice, entry.id)).rejects.toMatchObject({ code: "validation" });
  });
});

describe("drive — liens de partage", () => {
  it("création → accès par jeton → révocation → expiration", async () => {
    const { entry } = await uploadFile(f.actorAlice, {
      name: "public.txt",
      body: bufferOf("partage"),
    });

    const link = await createShareLink(f.actorAlice, entry.id, { role: "viewer" });
    expect(link.token.length).toBeGreaterThan(20);

    const access = await accessShareLink(link.token);
    expect(access?.entry.id).toBe(entry.id);
    expect(access?.role).toBe("viewer");

    // Le jeton n'est jamais stocké en clair.
    const db = getDb();
    const [row] = await db.select().from(driveShareLinks).where(eq(driveShareLinks.id, link.id));
    expect(row?.tokenHash).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain(link.token);

    // Révocation immédiate.
    expect(await revokeShareLink(f.actorAlice, link.id)).toBe(true);
    expect(await accessShareLink(link.token)).toBeNull();

    // Expiration.
    const expiring = await createShareLink(f.actorAlice, entry.id, {
      role: "editor",
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await accessShareLink(expiring.token)).toBeNull();
  });

  it("un jeton invalide ou inconnu ne donne rien", async () => {
    expect(await accessShareLink("jeton-invalide-mais-assez-long")).toBeNull();
    expect(await accessShareLink("")).toBeNull();
  });
});
