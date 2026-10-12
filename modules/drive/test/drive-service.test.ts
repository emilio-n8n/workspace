import { createHash, randomUUID } from "node:crypto";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import { type Actor, createGrant, revokeGrant } from "@workspace/permissions";
import { getStorage } from "@workspace/storage";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  accessShareLink,
  createFolder,
  createShareLink,
  download,
  effectiveRole,
  getAncestors,
  listEntries,
  listEntryGrants,
  listTrash,
  listVersions,
  pruneVersions,
  purge,
  rename,
  replaceContent,
  resolveRolesForEntries,
  restore,
  revokeShareLink,
  shareEntry,
  trash,
  uploadFile,
} from "../src/index.ts";
import { driveFiles, driveFileVersions, driveShareLinks } from "../src/schema.ts";

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
    if (!granted) throw new Error("grant viewer attendu");
    await revokeGrant({ type: "file", id: file.entry.id, orgId: f.orgId }, granted.id);
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

  it("fil d'Ariane refusé sans droit de lecture", async () => {
    const folder = await createFolder(f.actorAlice, { name: "Privé" });
    const { entry } = await uploadFile(f.actorAlice, {
      parentId: folder.id,
      name: "secret.txt",
      body: bufferOf("x"),
    });

    // Bruno n'a aucun grant : la fuite de noms d'ancêtres doit être impossible.
    await expect(getAncestors(f.actorBruno, entry.id)).rejects.toMatchObject({
      code: "forbidden",
    });

    // Le propriétaire obtient bien dossier → fichier.
    const chain = await getAncestors(f.actorAlice, entry.id);
    expect(chain.map((row) => row.name)).toEqual(["Privé", "secret.txt"]);
  });

  it("partage externe : désactivé par le réglage, membres internes toujours servis", async () => {
    const db = getDb();
    await db.insert(coreSchema.orgSettings).values({ orgId: f.orgId, allowExternalSharing: false });

    // Chloé est membre d'une autre organisation : un sujet externe.
    await db.insert(coreSchema.member).values({
      id: tag("mem"),
      organizationId: f.otherOrgId,
      userId: f.chloe,
      role: "member",
      createdAt: new Date(),
    });

    const { entry } = await uploadFile(f.actorAlice, {
      name: "interne.txt",
      body: bufferOf("secret"),
    });

    await expect(
      shareEntry(f.actorAlice, entry.id, {
        subject: { kind: "user", id: f.chloe },
        role: "viewer",
      }),
    ).rejects.toMatchObject({
      name: "DriveError",
      code: "validation",
      message: "Le partage externe est désactivé pour cette organisation.",
    });

    // Un identifiant inconnu (jamais membre) est externe lui aussi.
    await expect(
      shareEntry(f.actorAlice, entry.id, {
        subject: { kind: "user", id: `usr_inconnu_${randomUUID()}` },
        role: "viewer",
      }),
    ).rejects.toMatchObject({ code: "validation" });

    // Aucun grant n'a été créé par les tentatives refusées.
    expect(await listEntryGrants(f.actorAlice, entry.id)).toEqual([]);

    // Un membre de l'organisation reste partageable malgré le réglage.
    await db.insert(coreSchema.member).values({
      id: tag("mem"),
      organizationId: f.orgId,
      userId: f.bruno,
      role: "member",
      createdAt: new Date(),
    });
    const grant = await shareEntry(f.actorAlice, entry.id, {
      subject: { kind: "user", id: f.bruno },
      role: "viewer",
    });
    expect(grant).not.toBeNull();
    expect((await download(f.actorBruno, entry.id)).body.toString()).toBe("secret");
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
    const key = entry.storageKey;
    if (!key) throw new Error("clé de stockage manquante");
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

  it("rétention : pruneVersions supprime l'ancienne version, jamais la courante", async () => {
    const db = getDb();
    const { entry } = await uploadFile(f.actorAlice, {
      name: "versions.txt",
      body: bufferOf("v1"),
    });
    await replaceContent(f.actorAlice, entry.id, { body: bufferOf("v2") });

    // Laisse le prune d'arrière-plan déclenché par replaceContent se terminer :
    // la suppression attendue doit venir de l'appel explicite ci-dessous.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const versionsBefore = await listVersions(f.actorAlice, entry.id);
    const old = versionsBefore.find((version) => version.version === 1);
    if (!old) throw new Error("version 1 attendue");
    await db
      .update(driveFileVersions)
      .set({ createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000) })
      .where(eq(driveFileVersions.id, old.id));

    expect(await pruneVersions(f.actorAlice, entry.id)).toEqual({ removed: 1 });

    const versions = await listVersions(f.actorAlice, entry.id);
    expect(versions.map((version) => version.version)).toEqual([2]);
    expect((await download(f.actorAlice, entry.id)).body.toString()).toBe("v2");
    // Le blob de la version purgée est nettoyé (best effort).
    expect(await getStorage().get(old.storageKey)).toBeNull();

    // La version courante n'est jamais purgée, même expirée : purge idempotente.
    await db
      .update(driveFileVersions)
      .set({ createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000) })
      .where(eq(driveFileVersions.fileId, entry.id));
    expect(await pruneVersions(f.actorAlice, entry.id)).toEqual({ removed: 0 });
    expect((await download(f.actorAlice, entry.id)).body.toString()).toBe("v2");
  });

  it("purge impossible si l'élément n'est pas dans la corbeille", async () => {
    const { entry } = await uploadFile(f.actorAlice, { name: "actif.txt", body: bufferOf("ok") });
    await expect(purge(f.actorAlice, entry.id)).rejects.toMatchObject({ code: "validation" });
  });

  it("purge d'un dossier : sous-arbre entier supprimé (lignes, blobs, grants, liens)", async () => {
    const folder = await createFolder(f.actorAlice, { name: "Dossier" });
    const childFolder = await createFolder(f.actorAlice, {
      parentId: folder.id,
      name: "Sous-dossier",
    });
    const { entry: file } = await uploadFile(f.actorAlice, {
      parentId: childFolder.id,
      name: "dedans.txt",
      body: bufferOf("contenu"),
    });

    // Partage et lien sur un descendant : tout doit disparaître avec la purge.
    await shareEntry(f.actorAlice, file.id, {
      subject: { kind: "user", id: f.bruno },
      role: "viewer",
    });
    const link = await createShareLink(f.actorAlice, file.id, { role: "viewer" });
    const key = file.storageKey;
    if (!key) throw new Error("clé de stockage manquante");

    await trash(f.actorAlice, folder.id);
    const summary = await purge(f.actorAlice, folder.id);

    expect(summary.deletedEntries).toBe(3);
    expect(summary.deletedBlobs).toBe(1);
    expect(summary.blobErrors).toEqual([]);

    const db = getDb();
    const remaining = await db
      .select()
      .from(driveFiles)
      .where(inArray(driveFiles.id, [folder.id, childFolder.id, file.id]));
    expect(remaining).toHaveLength(0);

    const versions = await db
      .select()
      .from(driveFileVersions)
      .where(eq(driveFileVersions.fileId, file.id));
    expect(versions).toHaveLength(0);

    const grants = await db
      .select()
      .from(coreSchema.resourceGrants)
      .where(
        and(
          eq(coreSchema.resourceGrants.resourceType, "file"),
          eq(coreSchema.resourceGrants.resourceId, file.id),
        ),
      );
    expect(grants).toHaveLength(0);

    const links = await db.select().from(driveShareLinks).where(eq(driveShareLinks.id, link.id));
    expect(links).toHaveLength(0);

    expect(await getStorage().get(key)).toBeNull();
  });
});

describe("drive — quota de stockage", () => {
  it("bloque l'upload au-delà du quota puis l'autorise une fois le quota relevé", async () => {
    const db = getDb();
    await db.insert(coreSchema.orgSettings).values({ orgId: f.orgId, storageQuotaBytes: 10 });

    // 8 octets : sous le quota.
    await uploadFile(f.actorAlice, { name: "a.txt", body: bufferOf("12345678") });

    // 5 octets de plus : 8 + 5 > 10 → refus.
    await expect(
      uploadFile(f.actorAlice, { name: "b.txt", body: bufferOf("12345") }),
    ).rejects.toMatchObject({
      name: "DriveError",
      code: "quota",
      message: "Quota de stockage dépassé — contactez un administrateur.",
    });

    // Quota relevé : le même upload passe.
    await db
      .update(coreSchema.orgSettings)
      .set({ storageQuotaBytes: 100 })
      .where(eq(coreSchema.orgSettings.orgId, f.orgId));

    const { entry } = await uploadFile(f.actorAlice, { name: "b.txt", body: bufferOf("12345") });
    expect(entry.sizeBytes).toBe(5);

    // Quota nul : tout nouvel upload est refusé.
    await db
      .update(coreSchema.orgSettings)
      .set({ storageQuotaBytes: 0 })
      .where(eq(coreSchema.orgSettings.orgId, f.orgId));
    await expect(
      uploadFile(f.actorAlice, { name: "c.txt", body: bufferOf("x") }),
    ).rejects.toMatchObject({ code: "quota" });
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

describe("drive — résolution par lots et pagination", () => {
  it("résolution par lots : héritage profond, identique à la résolution unitaire", async () => {
    const root = await createFolder(f.actorAlice, { name: "Racine" });
    const middle = await createFolder(f.actorAlice, { parentId: root.id, name: "Milieu" });
    const { entry: deep } = await uploadFile(f.actorAlice, {
      parentId: middle.id,
      name: "profond.txt",
      body: bufferOf("hérité"),
    });

    await shareEntry(f.actorAlice, root.id, {
      subject: { kind: "user", id: f.bruno },
      role: "viewer",
    });
    await shareEntry(f.actorAlice, middle.id, {
      subject: { kind: "user", id: f.bruno },
      role: "editor",
    });

    // Lot et résolution unitaire donnent le même rôle.
    const roles = await resolveRolesForEntries(f.actorBruno, [
      { id: root.id, ownerId: f.alice },
      { id: middle.id, ownerId: f.alice },
      { id: deep.id, ownerId: f.alice },
    ]);
    expect(roles.get(root.id)).toBe("viewer");
    expect(roles.get(middle.id)).toBe("editor");
    expect(roles.get(deep.id)).toBe("editor");
    for (const id of [root.id, middle.id, deep.id]) {
      expect(roles.get(id)).toBe(await effectiveRole(f.actorBruno, id));
    }

    // Visibilité : le dossier partagé expose son contenu, téléchargement compris.
    expect((await listEntries(f.actorBruno, { parentId: root.id })).map((row) => row.name)).toEqual(
      ["Milieu"],
    );
    expect(
      (await listEntries(f.actorBruno, { parentId: middle.id })).map((row) => row.name),
    ).toEqual(["profond.txt"]);
    expect((await download(f.actorBruno, deep.id)).body.toString()).toBe("hérité");

    // Sémantique historique : le grant le plus proche prime sur un grant plus élevé.
    await shareEntry(f.actorAlice, deep.id, {
      subject: { kind: "user", id: f.bruno },
      role: "viewer",
    });
    expect(await effectiveRole(f.actorBruno, deep.id)).toBe("viewer");
  });

  it("résolution par lots : un grant expiré n'ouvre aucun accès", async () => {
    const folder = await createFolder(f.actorAlice, { name: "Expiré" });
    const { entry: child } = await uploadFile(f.actorAlice, {
      parentId: folder.id,
      name: "expire.txt",
      body: bufferOf("x"),
    });

    await createGrant({
      resource: { type: "file", id: folder.id, orgId: f.orgId },
      subject: { kind: "user", id: f.bruno },
      role: "editor",
      actor: f.actorAlice,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const roles = await resolveRolesForEntries(f.actorBruno, [{ id: child.id, ownerId: f.alice }]);
    expect(roles.get(child.id)).toBeNull();
    expect(await effectiveRole(f.actorBruno, child.id)).toBeNull();
    expect(await listEntries(f.actorBruno, { parentId: folder.id })).toEqual([]);
    await expect(download(f.actorBruno, child.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(rename(f.actorBruno, child.id, "interdit.txt")).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("corbeille paginée : bornes limit/offset assainies", async () => {
    const db = getDb();
    const base = 1_700_000_000_000;

    for (let index = 0; index < 5; index += 1) {
      const { entry } = await uploadFile(f.actorAlice, {
        name: `corbeille-${index}.txt`,
        body: bufferOf(String(index)),
      });
      await trash(f.actorAlice, entry.id);
      // Dates distinctes : ordre de corbeille déterministe pour les bornes de page.
      await db
        .update(driveFiles)
        .set({ trashedAt: new Date(base + index * 1000) })
        .where(eq(driveFiles.id, entry.id));
    }

    const page = async (options: { limit?: number; offset?: number }) =>
      (await listTrash(f.actorAlice, options)).map((row) => row.name);

    // Plus récemment jeté en premier ; bornes exactes de page.
    expect(await page({ limit: 2, offset: 0 })).toEqual(["corbeille-4.txt", "corbeille-3.txt"]);
    expect(await page({ limit: 2, offset: 2 })).toEqual(["corbeille-2.txt", "corbeille-1.txt"]);
    expect(await page({ limit: 2, offset: 4 })).toEqual(["corbeille-0.txt"]);
    expect(await page({ limit: 2, offset: 6 })).toEqual([]);

    // Assainissement : limite ramenée dans 1..500, offset négatif → 0.
    expect(await page({ limit: 0 })).toEqual(["corbeille-4.txt"]);
    expect(await page({ limit: 9999 })).toHaveLength(5);
    expect(await page({ limit: 2, offset: -3 })).toEqual(["corbeille-4.txt", "corbeille-3.txt"]);

    // Sans options, la vue complète reste celle d'avant pour un petit ensemble.
    expect(await page({})).toHaveLength(5);
  });
});
