import { randomUUID } from "node:crypto";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import { driveFiles, shareEntry, trash } from "@workspace/drive";
import { type Actor, createGrant, revokeGrant } from "@workspace/permissions";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addComment,
  createDocument,
  DOCS_MIME,
  DocsError,
  deleteComment,
  EMPTY_DOC,
  exportDocument,
  getDocumentByFileId,
  getDocumentVersion,
  listComments,
  listDocuments,
  listDocumentVersions,
  pruneDocumentVersions,
  renameDocument,
  resolveComment,
  restoreDocumentVersion,
  saveDocument,
} from "../src/index.ts";
import { docsVersions } from "../src/schema.ts";

const { user, organization, auditEvents } = coreSchema;

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

describe("docs — commentaires", () => {
  it("ajoute des commentaires puis les liste avec auteur et extrait", async () => {
    const { entry } = await createDocument(f.actorAlice, { title: "Compte rendu" });

    const first = await addComment(f.actorAlice, entry.id, {
      body: "  Peut-être préciser le budget.  ",
      quote: "Le budget prévisionnel",
    });
    expect(first.body).toBe("Peut-être préciser le budget.");
    expect(first.quote).toBe("Le budget prévisionnel");
    expect(first.authorName).toBe("Alice");
    expect(first.authorId).toBe(f.alice);
    expect(first.resolvedAt).toBeNull();
    expect(typeof first.createdAt).toBe("string");

    const second = await addComment(f.actorAlice, entry.id, { body: "Bien vu" });

    const list = await listComments(f.actorAlice, entry.id);
    expect(list.map((comment) => comment.id)).toEqual([first.id, second.id]);
    expect(list.map((comment) => comment.authorName)).toEqual(["Alice", "Alice"]);
    expect(list[1]?.quote).toBeNull();
  });

  it("un viewer ne commente pas, un commenter oui (les deux lisent)", async () => {
    const { entry } = await createDocument(f.actorAlice, { title: "Discussion" });
    await addComment(f.actorAlice, entry.id, { body: "Merci de relire" });

    const grant = await shareEntry(f.actorAlice, entry.id, {
      subject: { kind: "user", id: f.bruno },
      role: "viewer",
    });
    if (!grant) throw new Error("grant viewer attendu");

    // Le viewer lit les fils…
    expect(await listComments(f.actorBruno, entry.id)).toHaveLength(1);

    // …mais ne peut pas commenter.
    await expect(
      addComment(f.actorBruno, entry.id, { body: "Je commente quand même" }),
    ).rejects.toMatchObject({ code: "forbidden" });

    // Promotion commenter : l'ajout passe et apparaît dans la liste.
    await revokeGrant({ type: "file", id: entry.id, orgId: f.orgId }, grant.id);
    await createGrant({
      resource: { type: "file", id: entry.id, orgId: f.orgId },
      subject: { kind: "user", id: f.bruno },
      role: "commenter",
      actor: f.actorAlice,
    });

    const added = await addComment(f.actorBruno, entry.id, { body: "Une remarque" });
    expect(added.authorName).toBe("Bruno");
    expect(await listComments(f.actorBruno, entry.id)).toHaveLength(2);
  });

  it("résout puis rouvre un commentaire (resolvedAt)", async () => {
    const { entry } = await createDocument(f.actorAlice, { title: "Suivi" });
    const comment = await addComment(f.actorAlice, entry.id, { body: "À corriger" });
    expect(comment.resolvedAt).toBeNull();

    const resolved = await resolveComment(f.actorAlice, entry.id, comment.id, true);
    expect(resolved.resolvedAt).not.toBeNull();
    expect((await listComments(f.actorAlice, entry.id))[0]?.resolvedAt).toBe(resolved.resolvedAt);

    const reopened = await resolveComment(f.actorAlice, entry.id, comment.id, false);
    expect(reopened.resolvedAt).toBeNull();

    await expect(resolveComment(f.actorAlice, entry.id, randomUUID(), true)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("suppression : auteur et propriétaire autorisés, autre membre refusé", async () => {
    const { entry } = await createDocument(f.actorAlice, { title: "Modération" });
    await createGrant({
      resource: { type: "file", id: entry.id, orgId: f.orgId },
      subject: { kind: "user", id: f.bruno },
      role: "commenter",
      actor: f.actorAlice,
    });

    // Alice (propriétaire) commente ; Bruno (commenter, non auteur) est refusé.
    const byAlice = await addComment(f.actorAlice, entry.id, { body: "Note du propriétaire" });
    await expect(deleteComment(f.actorBruno, entry.id, byAlice.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await listComments(f.actorAlice, entry.id)).toHaveLength(1);

    // Bruno supprime son propre commentaire (auteur).
    const byBruno = await addComment(f.actorBruno, entry.id, { body: "Remarque de Bruno" });
    await deleteComment(f.actorBruno, entry.id, byBruno.id);
    expect(await listComments(f.actorBruno, entry.id)).toHaveLength(1);

    // Alice (propriétaire) supprime le commentaire d'un autre membre.
    const byBrunoAgain = await addComment(f.actorBruno, entry.id, { body: "Deuxième remarque" });
    await deleteComment(f.actorAlice, entry.id, byBrunoAgain.id);
    expect((await listComments(f.actorAlice, entry.id)).map((comment) => comment.body)).toEqual([
      "Note du propriétaire",
    ]);
  });

  it("isolation inter-organisations : commentaires inaccessibles", async () => {
    const { entry } = await createDocument(f.actorAlice, { title: "Privé" });
    const comment = await addComment(f.actorAlice, entry.id, { body: "Interne" });

    await expect(addComment(f.actorChloe, entry.id, { body: "Intrusion" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(listComments(f.actorChloe, entry.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(resolveComment(f.actorChloe, entry.id, comment.id, true)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(deleteComment(f.actorChloe, entry.id, comment.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("validation : corps vide, trop long ; extrait trop long ou vide normalisé", async () => {
    const { entry } = await createDocument(f.actorAlice, { title: "Validation" });

    await expect(addComment(f.actorAlice, entry.id, { body: "   " })).rejects.toMatchObject({
      code: "validation",
    });
    await expect(
      addComment(f.actorAlice, entry.id, { body: "a".repeat(4001) }),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(
      addComment(f.actorAlice, entry.id, { body: "Corps valide", quote: "x".repeat(501) }),
    ).rejects.toMatchObject({ code: "validation" });
    expect(await listComments(f.actorAlice, entry.id)).toHaveLength(0);

    const comment = await addComment(f.actorAlice, entry.id, { body: "Corps", quote: "   " });
    expect(comment.quote).toBeNull();
  });
});

describe("docs — audit (mutations notables uniquement)", () => {
  const auditEntries = () =>
    getDb().select().from(auditEvents).where(eq(auditEvents.orgId, f.orgId));

  it("journalise la création et le renommage du document", async () => {
    const { entry } = await createDocument(f.actorAlice, { title: "Auditable" });
    await renameDocument(f.actorAlice, entry.id, "Audité");

    const rows = await auditEntries();
    const created = rows.filter((row) => row.action === "docs.document.create");
    const renamed = rows.filter((row) => row.action === "docs.document.rename");
    expect(created).toHaveLength(1);
    expect(renamed).toHaveLength(1);
    expect(created[0]).toMatchObject({
      orgId: f.orgId,
      actorUserId: f.alice,
      resourceType: "document",
      resourceId: entry.id,
      result: "success",
    });
    expect(renamed[0]).toMatchObject({
      actorUserId: f.alice,
      resourceType: "document",
      resourceId: entry.id,
      result: "success",
    });
  });

  it("journalise ajout, résolution, réouverture et suppression d'un commentaire", async () => {
    const { entry } = await createDocument(f.actorAlice, { title: "Commentaires audités" });
    const comment = await addComment(f.actorAlice, entry.id, { body: "À corriger" });
    await resolveComment(f.actorAlice, entry.id, comment.id, true);
    await resolveComment(f.actorAlice, entry.id, comment.id, false);
    await deleteComment(f.actorAlice, entry.id, comment.id);

    const rows = (await auditEntries()).filter((row) => row.action.startsWith("docs.comment."));
    expect(rows.map((row) => row.action).sort()).toEqual([
      "docs.comment.add",
      "docs.comment.delete",
      "docs.comment.reopen",
      "docs.comment.resolve",
    ]);
    for (const row of rows) {
      expect(row.resourceType).toBe("document");
      expect(row.resourceId).toBe(entry.id);
    }
    const added = rows.find((row) => row.action === "docs.comment.add");
    expect(added?.metadata).toEqual({ commentId: comment.id });
  });

  it("l'autosave, l'export et la lecture des versions ne produisent aucune entrée", async () => {
    const { entry } = await createDocument(f.actorAlice, { title: "Brouillon" });
    const before = await auditEntries();
    expect(before.map((row) => row.action)).toEqual(["docs.document.create"]);

    await saveDocument(f.actorAlice, entry.id, { content: contentV2, mode: "replace-latest" });
    await saveDocument(f.actorAlice, entry.id, { content: contentV3, mode: "append" });
    await listDocumentVersions(f.actorAlice, entry.id);
    await getDocumentVersion(f.actorAlice, entry.id, 1);
    await exportDocument(f.actorAlice, entry.id, "md");

    const after = await auditEntries();
    expect(after).toHaveLength(before.length);
    expect(after.map((row) => row.action)).toEqual(["docs.document.create"]);
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

describe("docs — restauration de versions", () => {
  it("recopie le contenu choisi dans une nouvelle version (historique intact + audit)", async () => {
    const { entry } = await createDocument(f.actorAlice, { title: "Historique" });
    await saveDocument(f.actorAlice, entry.id, { content: contentV2, mode: "append" });
    await saveDocument(f.actorAlice, entry.id, { content: contentV3, mode: "append" });

    const restored = await restoreDocumentVersion(f.actorAlice, entry.id, 2);
    expect(restored.version).toBe(4);

    // La relecture renvoie le contenu de la version restaurée.
    const reread = await getDocumentByFileId(f.actorAlice, entry.id);
    expect(reread.content).toEqual(contentV2);
    expect(reread.document.currentVersion).toBe(4);

    // Historique préservé : les anciennes versions restent intactes, les
    // numéros séquentiels, et la restauration est elle-même une version.
    const versions = await listDocumentVersions(f.actorAlice, entry.id);
    expect(versions.map((v) => v.version)).toEqual([4, 3, 2, 1]);
    expect(versions.find((v) => v.version === 1)?.content).toEqual(EMPTY_DOC);
    expect(versions.find((v) => v.version === 2)?.content).toEqual(contentV2);
    expect(versions.find((v) => v.version === 3)?.content).toEqual(contentV3);
    expect(versions.find((v) => v.version === 4)?.content).toEqual(contentV2);

    // Une seconde restauration continue la séquence.
    const again = await restoreDocumentVersion(f.actorAlice, entry.id, 1);
    expect(again.version).toBe(5);

    // Audit : une entrée par restauration, avec la version d'origine.
    const rows = await getDb().select().from(auditEvents).where(eq(auditEvents.orgId, f.orgId));
    const restoreRows = rows.filter((row) => row.action === "docs.document.restore");
    expect(restoreRows).toHaveLength(2);
    expect(restoreRows.map((row) => row.metadata)).toEqual(
      expect.arrayContaining([{ restoredFrom: 2 }, { restoredFrom: 1 }]),
    );
    for (const row of restoreRows) {
      expect(row).toMatchObject({
        actorUserId: f.alice,
        resourceType: "document",
        resourceId: entry.id,
        result: "success",
      });
    }
  });

  it("version inconnue : not_found, sans créer de version", async () => {
    const { entry } = await createDocument(f.actorAlice, { title: "Inconnue" });
    await saveDocument(f.actorAlice, entry.id, { content: contentV2, mode: "append" });

    await expect(restoreDocumentVersion(f.actorAlice, entry.id, 42)).rejects.toMatchObject({
      name: "DocsError",
      code: "not_found",
    });

    const versions = await listDocumentVersions(f.actorAlice, entry.id);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect((await getDocumentByFileId(f.actorAlice, entry.id)).content).toEqual(contentV2);
  });

  it("un viewer ne restaure pas (le rôle write est requis)", async () => {
    const { entry } = await createDocument(f.actorAlice, { title: "Partagé" });
    await saveDocument(f.actorAlice, entry.id, { content: contentV2, mode: "append" });
    const grant = await shareEntry(f.actorAlice, entry.id, {
      subject: { kind: "user", id: f.bruno },
      role: "viewer",
    });
    if (!grant) throw new Error("grant viewer attendu");

    // Le viewer lit l'historique…
    expect(await listDocumentVersions(f.actorBruno, entry.id)).toHaveLength(2);

    // …mais la restauration exige le rôle write.
    await expect(restoreDocumentVersion(f.actorBruno, entry.id, 1)).rejects.toMatchObject({
      code: "forbidden",
    });

    // Rien n'a changé.
    expect(await listDocumentVersions(f.actorAlice, entry.id)).toHaveLength(2);
    expect((await getDocumentByFileId(f.actorAlice, entry.id)).content).toEqual(contentV2);
  });
});

describe("docs — lecture d'une version", () => {
  it("retourne le contenu exact d'une version ancienne sans toucher au document", async () => {
    const { entry } = await createDocument(f.actorAlice, { title: "Historique" });
    await saveDocument(f.actorAlice, entry.id, { content: contentV2, mode: "append" });
    await saveDocument(f.actorAlice, entry.id, { content: contentV3, mode: "append" });

    const first = await getDocumentVersion(f.actorAlice, entry.id, 1);
    expect(first.version).toBe(1);
    expect(first.content).toEqual(EMPTY_DOC);
    expect(first.createdBy).toBe(f.alice);
    expect(typeof first.createdAt).toBe("string");
    expect(Number.isNaN(new Date(first.createdAt).getTime())).toBe(false);

    const second = await getDocumentVersion(f.actorAlice, entry.id, 2);
    expect(second.version).toBe(2);
    expect(second.content).toEqual(contentV2);
    expect(second.createdBy).toBe(f.alice);

    // Consulter une version est une lecture : la version courante reste intacte.
    const current = await getDocumentByFileId(f.actorAlice, entry.id);
    expect(current.content).toEqual(contentV3);
    expect(current.document.currentVersion).toBe(3);
  });

  it("version inconnue : not_found", async () => {
    const { entry } = await createDocument(f.actorAlice, { title: "Inconnue" });
    await saveDocument(f.actorAlice, entry.id, { content: contentV2, mode: "append" });

    await expect(getDocumentVersion(f.actorAlice, entry.id, 42)).rejects.toMatchObject({
      name: "DocsError",
      code: "not_found",
      message: "Version introuvable.",
    });
    await expect(getDocumentVersion(f.actorAlice, entry.id, 0)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("un viewer prévisualise une version mais ne peut pas la restaurer", async () => {
    const { entry } = await createDocument(f.actorAlice, { title: "Partagé" });
    await saveDocument(f.actorAlice, entry.id, { content: contentV2, mode: "append" });
    const grant = await shareEntry(f.actorAlice, entry.id, {
      subject: { kind: "user", id: f.bruno },
      role: "viewer",
    });
    if (!grant) throw new Error("grant viewer attendu");

    // Lecture d'une version : autorisée au viewer.
    const preview = await getDocumentVersion(f.actorBruno, entry.id, 2);
    expect(preview.content).toEqual(contentV2);

    // Restauration : réservée au rôle write.
    await expect(restoreDocumentVersion(f.actorBruno, entry.id, 2)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect((await getDocumentByFileId(f.actorAlice, entry.id)).content).toEqual(contentV2);
  });
});
