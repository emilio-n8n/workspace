import { randomUUID } from "node:crypto";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import { driveFiles, shareEntry, trash } from "@workspace/drive";
import { type Actor, createGrant, revokeGrant } from "@workspace/permissions";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDocument,
  DOCS_MIME,
  DocsError,
  EMPTY_DOC,
  exportDocument,
  getDocumentByFileId,
  listDocuments,
  listDocumentVersions,
  pruneDocumentVersions,
  renameDocument,
  saveDocument,
} from "../src/index.ts";
import { docsVersions } from "../src/schema.ts";

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
    actorAlice: { userId: alice, orgId },
    actorBruno: { userId: bruno, orgId },
    actorChloe: { userId: chloe, orgId: otherOrgId },
  };
}

async function cleanup(f: Fixtures): Promise<void> {
  const db = getDb();
  await db.delete(organization).where(eq(organization.id, f.orgId));
  await db.delete(organization).where(eq(organization.id, f.otherOrgId));
  for (const id of [f.alice, f.bruno]) await db.delete(user).where(eq(user.id, id));
  await db.delete(user).where(eq(user.id, f.actorChloe.userId));
}

const contentV2 = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Deuxième version", marks: [{ type: "bold" }] }],
    },
  ],
};

const contentV3 = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Troisième version" }] }],
};

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

describe("docs — cycle de vie", () => {
  it("crée un document : pointeur Drive + contenu vide + liste", async () => {
    const { entry, document } = await createDocument(f.actorAlice, { title: "Compte rendu" });

    expect(entry.kind).toBe("file");
    expect(entry.mimeType).toBe(DOCS_MIME);
    expect(entry.storageKey).toBeNull(); // pointeur : aucun binaire
    expect(document.currentVersion).toBe(1);

    const fetched = await getDocumentByFileId(f.actorAlice, entry.id);
    expect(fetched.content).toEqual(EMPTY_DOC);
    expect(fetched.document.title).toBe("Compte rendu");

    const listed = await listDocuments(f.actorAlice);
    expect(listed.map((item) => item.name)).toEqual(["Compte rendu"]);
  });

  it("refuse les titres invalides", async () => {
    await expect(createDocument(f.actorAlice, { title: "   " })).rejects.toMatchObject({
      name: "DocsError",
      code: "validation",
    });
    await expect(createDocument(f.actorAlice, { title: "a/b" })).rejects.toBeInstanceOf(DocsError);
  });

  it("autosave remplace la dernière version, l'instantané explicite en ajoute une", async () => {
    const { entry } = await createDocument(f.actorAlice, { title: "Notes" });

    const draft = await saveDocument(f.actorAlice, entry.id, {
      content: contentV2,
      mode: "replace-latest",
    });
    expect(draft.version).toBe(1);
    expect((await getDocumentByFileId(f.actorAlice, entry.id)).content).toEqual(contentV2);

    // Un deuxième autosave ne crée pas de version supplémentaire.
    await saveDocument(f.actorAlice, entry.id, {
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "encore" }] }],
      },
      mode: "replace-latest",
    });
    expect(await listDocumentVersions(f.actorAlice, entry.id)).toHaveLength(1);

    // Instantané explicite : nouvelle version.
    const snapshot = await saveDocument(f.actorAlice, entry.id, {
      content: contentV2,
      mode: "append",
    });
    expect(snapshot.version).toBe(2);

    const versions = await listDocumentVersions(f.actorAlice, entry.id);
    expect(versions.map((version) => version.version)).toEqual([2, 1]);
  });

  it("renomme le document (titre synchronisé avec Drive)", async () => {
    const { entry } = await createDocument(f.actorAlice, { title: "Avant" });
    const renamed = await renameDocument(f.actorAlice, entry.id, "Après");

    expect(renamed.name).toBe("Après");
    expect((await getDocumentByFileId(f.actorAlice, entry.id)).document.title).toBe("Après");
  });
});

describe("docs — verrouillage optimiste (autosave)", () => {
  it("accepte une base à jour et retourne une nouvelle révision", async () => {
    const { entry } = await createDocument(f.actorAlice, { title: "Concurrent" });
    const initial = await getDocumentByFileId(f.actorAlice, entry.id);
    expect(typeof initial.revision).toBe("string");

    const saved = await saveDocument(f.actorAlice, entry.id, {
      content: contentV2,
      mode: "replace-latest",
      baseUpdatedAt: initial.revision,
    });

    expect(saved.version).toBe(1);
    expect(saved.updatedAt).not.toBe(initial.revision);

    const reread = await getDocumentByFileId(f.actorAlice, entry.id);
    expect(reread.revision).toBe(saved.updatedAt);
    expect(reread.content).toEqual(contentV2);
  });

  it("refuse une base périmée sans toucher au contenu (conflit)", async () => {
    const { entry } = await createDocument(f.actorAlice, { title: "Concurrent" });
    const initial = await getDocumentByFileId(f.actorAlice, entry.id);

    // Un premier client sauvegarde…
    const first = await saveDocument(f.actorAlice, entry.id, {
      content: contentV2,
      baseUpdatedAt: initial.revision,
    });

    // …puis un second écrase avec un contenu plus récent.
    const newerContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Plus récent" }] }],
    };
    const second = await saveDocument(f.actorAlice, entry.id, {
      content: newerContent,
      baseUpdatedAt: first.updatedAt,
    });
    expect(second.updatedAt).not.toBe(first.updatedAt);

    // Le premier client rejoue sa sauvegarde avec une base périmée : refus.
    await expect(
      saveDocument(f.actorAlice, entry.id, {
        content: contentV2,
        baseUpdatedAt: first.updatedAt,
      }),
    ).rejects.toMatchObject({
      name: "DocsError",
      code: "conflict",
      message: expect.stringContaining("modifié ailleurs"),
    });

    // Le contenu du second client n'a pas été écrasé.
    const reread = await getDocumentByFileId(f.actorAlice, entry.id);
    expect(reread.content).toEqual(newerContent);
    expect(reread.revision).toBe(second.updatedAt);
  });

  it("append retourne une révision fraîche sans exiger de base", async () => {
    const { entry } = await createDocument(f.actorAlice, { title: "Concurrent" });
    const initial = await getDocumentByFileId(f.actorAlice, entry.id);

    const snapshot = await saveDocument(f.actorAlice, entry.id, {
      content: contentV2,
      mode: "append",
    });
    expect(snapshot.version).toBe(2);
    expect(snapshot.updatedAt).not.toBe(initial.revision);

    const later = await saveDocument(f.actorAlice, entry.id, {
      content: contentV2,
      mode: "append",
    });
    expect(later.version).toBe(3);
    expect(later.updatedAt).not.toBe(snapshot.updatedAt);

    expect((await getDocumentByFileId(f.actorAlice, entry.id)).revision).toBe(later.updatedAt);
  });

  it("enchaîne deux sauvegardes avec la révision retournée comme base", async () => {
    const { entry } = await createDocument(f.actorAlice, { title: "Concurrent" });
    const initial = await getDocumentByFileId(f.actorAlice, entry.id);

    const first = await saveDocument(f.actorAlice, entry.id, {
      content: contentV2,
      baseUpdatedAt: initial.revision,
    });
    const second = await saveDocument(f.actorAlice, entry.id, {
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Encore" }] }],
      },
      baseUpdatedAt: first.updatedAt,
    });

    expect(second.version).toBe(1);
    expect(second.updatedAt).not.toBe(first.updatedAt);
  });

  it("deux sauvegardes simultanées sur la même base : une seule passe", async () => {
    const { entry } = await createDocument(f.actorAlice, { title: "Concurrent" });
    const initial = await getDocumentByFileId(f.actorAlice, entry.id);

    const attempt = (text: string) =>
      saveDocument(f.actorAlice, entry.id, {
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        },
        baseUpdatedAt: initial.revision,
      }).then(
        (result) => ({ ok: true as const, result }),
        (error: unknown) => ({ ok: false as const, error }),
      );

    const [a, b] = await Promise.all([attempt("Onglet A"), attempt("Onglet B")]);

    // Le verrou de document (SELECT … FOR UPDATE) sérialise les deux
    // transactions : la seconde voit la révision avancée et échoue.
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);

    const loser = a.ok ? b : a;
    if (loser.ok) throw new Error("les deux sauvegardes ont été acceptées");
    expect(loser.error).toBeInstanceOf(DocsError);
    expect(loser.error).toMatchObject({ code: "conflict" });

    // Le contenu final est exactement celui du gagnant, sans mélange.
    const winnerText = a.ok ? "Onglet A" : "Onglet B";
    const reread = await getDocumentByFileId(f.actorAlice, entry.id);
    expect(JSON.stringify(reread.content)).toContain(winnerText);
  });
});

describe("docs — permissions et isolation", () => {
  it("viewer lit mais ne modifie pas ; editor modifie ; révocation immédiate", async () => {
    const { entry } = await createDocument(f.actorAlice, { title: "Partagé" });

    // Refus par défaut : même organisation mais aucun grant ⇒ forbidden
    // (l'isolation inter-organisations, elle, renvoie not_found plus bas).
    await expect(getDocumentByFileId(f.actorBruno, entry.id)).rejects.toMatchObject({
      code: "forbidden",
    });

    const grant = await shareEntry(f.actorAlice, entry.id, {
      subject: { kind: "user", id: f.bruno },
      role: "viewer",
    });
    expect(grant).not.toBeNull();

    // Bruno (viewer) lit…
    const read = await getDocumentByFileId(f.actorBruno, entry.id);
    expect(read.document.title).toBe("Partagé");

    // …mais ne peut pas sauvegarder.
    await expect(
      saveDocument(f.actorBruno, entry.id, { content: contentV2 }),
    ).rejects.toMatchObject({ code: "forbidden" });

    // Promotion editor.
    if (!grant) throw new Error("grant viewer attendu");
    await revokeGrant({ type: "file", id: entry.id, orgId: f.orgId }, grant.id);
    await createGrant({
      resource: { type: "file", id: entry.id, orgId: f.orgId },
      subject: { kind: "user", id: f.bruno },
      role: "editor",
      actor: f.actorAlice,
    });
    const saved = await saveDocument(f.actorBruno, entry.id, {
      content: contentV2,
      mode: "append",
    });
    expect(saved.version).toBe(2);
  });

  it("isolation inter-organisations : aucun accès", async () => {
    const { entry } = await createDocument(f.actorAlice, { title: "Privé" });
    await expect(getDocumentByFileId(f.actorChloe, entry.id)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(await listDocuments(f.actorChloe)).toHaveLength(0);
  });

  it("un document en corbeille n'est plus accessible", async () => {
    const { entry } = await createDocument(f.actorAlice, { title: "À jeter" });
    await trash(f.actorAlice, entry.id);
    await expect(getDocumentByFileId(f.actorAlice, entry.id)).rejects.toMatchObject({
      code: "not_found",
    });
    const db = getDb();
    const rows = await db.select().from(driveFiles).where(eq(driveFiles.id, entry.id));
    expect(rows[0]?.status).toBe("trashed");
  });
});

describe("docs — export", () => {
  it("exporte le Markdown et le HTML à partir du contenu courant", async () => {
    const { entry } = await createDocument(f.actorAlice, { title: "Rapport trimestriel" });
    await saveDocument(f.actorAlice, entry.id, { content: contentV2, mode: "append" });

    const markdown = await exportDocument(f.actorAlice, entry.id, "md");
    expect(markdown.name).toBe("Rapport trimestriel.md");
    expect(markdown.body).toContain("**Deuxième version**");

    const html = await exportDocument(f.actorAlice, entry.id, "html");
    expect(html.name).toBe("Rapport trimestriel.html");
    expect(html.body).toContain("<strong>Deuxième version</strong>");
    expect(html.body).toContain("<!doctype html>");
  });
});

describe("docs — rétention des versions", () => {
  it("pruneDocumentVersions : supprime les versions expirées et garde la courante", async () => {
    const db = getDb();
    const { entry } = await createDocument(f.actorAlice, { title: "Historique" });
    await saveDocument(f.actorAlice, entry.id, { content: contentV2, mode: "append" });

    // Laisse le prune d'arrière-plan déclenché par saveDocument se terminer :
    // la suppression attendue doit venir de l'appel explicite ci-dessous.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const versionsBefore = await listDocumentVersions(f.actorAlice, entry.id);
    const old = versionsBefore.find((version) => version.version === 1);
    if (!old) throw new Error("version 1 attendue");
    await db
      .update(docsVersions)
      .set({ createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000) })
      .where(eq(docsVersions.id, old.id));

    expect(await pruneDocumentVersions(f.actorAlice, entry.id)).toEqual({ removed: 1 });

    const versions = await listDocumentVersions(f.actorAlice, entry.id);
    expect(versions.map((version) => version.version)).toEqual([2]);
    const reread = await getDocumentByFileId(f.actorAlice, entry.id);
    expect(reread.content).toEqual(contentV2);
    expect(reread.document.currentVersion).toBe(2);

    // La version courante n'est jamais purgée : second appel sans effet.
    expect(await pruneDocumentVersions(f.actorAlice, entry.id)).toEqual({ removed: 0 });
  });

  it("append après purge : la nouvelle version est conservée", async () => {
    const db = getDb();
    const { entry } = await createDocument(f.actorAlice, { title: "Historique" });
    await saveDocument(f.actorAlice, entry.id, { content: contentV2, mode: "append" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const old = (await listDocumentVersions(f.actorAlice, entry.id)).find(
      (version) => version.version === 1,
    );
    if (!old) throw new Error("version 1 attendue");
    await db
      .update(docsVersions)
      .set({ createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000) })
      .where(eq(docsVersions.id, old.id));
    await pruneDocumentVersions(f.actorAlice, entry.id);

    const appended = await saveDocument(f.actorAlice, entry.id, {
      content: contentV3,
      mode: "append",
    });
    expect(appended.version).toBe(3);
    expect((await getDocumentByFileId(f.actorAlice, entry.id)).content).toEqual(contentV3);
    expect((await listDocumentVersions(f.actorAlice, entry.id)).map((v) => v.version)).toEqual([
      3, 2,
    ]);
  });
});
