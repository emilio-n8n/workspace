import { randomUUID } from "node:crypto";
import { schema as coreSchema, getDb } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLabel,
  deleteLabel,
  ensureMailbox,
  getMessage,
  isMailError,
  listLabelCounts,
  listLabels,
  listMessages,
  markThreadRead,
  saveDraft,
  sendMail,
  setMessageLabels,
  updateLabel,
  uploadMailAttachment,
} from "../src/index.ts";
import { mailMessageLabels, mailMessages } from "../src/schema.ts";

const { user, organization, auditEvents } = coreSchema;

let counter = 0;
const tag = (prefix: string) => `${prefix}${++counter}_${randomUUID().slice(0, 8)}`;

let orgId = "";
let actor: Actor;
let other: Actor;
let box: string;

beforeEach(async () => {
  const db = getDb();
  const now = new Date();
  orgId = tag("org");
  await db
    .insert(organization)
    .values({ id: orgId, name: tag("Org "), slug: orgId, createdAt: now });
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
  actor = { userId: await makeUser("Alice"), orgId };
  other = { userId: await makeUser("Bruno"), orgId };
  box = (await ensureMailbox(actor)).address;
});

afterEach(async () => {
  const db = getDb();
  await db.delete(organization).where(eq(organization.id, orgId));
  await db.delete(user).where(inArray(user.id, [actor.userId, other.userId]));
});

afterAll(async () => {
  const { closeDb } = await import("@workspace/database");
  await closeDb();
});

/** Insère un message directement et retourne son identifiant. */
async function insertMessage(
  values: Partial<typeof mailMessages.$inferInsert> = {},
): Promise<string> {
  const mailbox = await ensureMailbox(actor);
  const [created] = await getDb()
    .insert(mailMessages)
    .values({
      orgId,
      mailboxId: mailbox.id,
      folder: "inbox",
      fromAddress: "expediteur@example.org",
      toAddresses: [box],
      subject: "Sujet",
      body: "Corps",
      ...values,
    })
    .returning({ id: mailMessages.id });
  if (!created) throw new Error("insertion impossible");
  return created.id;
}

describe("libellés — création et gestion", () => {
  it("crée, liste et renomme un libellé, trié par nom", async () => {
    const first = await createLabel(actor, { name: "  Clients   VIP  ", color: "vert" });
    // Les espaces sont normalisés, jamais tronqués en silence.
    expect(first.name).toBe("Clients VIP");
    expect(first.color).toBe("vert");
    await createLabel(actor, { name: "À relire" });

    const labels = await listLabels(actor);
    expect(labels.map((label) => label.name)).toEqual(["À relire", "Clients VIP"]);

    const renamed = await updateLabel(actor, { id: first.id, name: "Clients", color: "orange" });
    expect(renamed.name).toBe("Clients");
    expect(renamed.color).toBe("orange");
  });

  it("refuse un nom vide, trop long, ou une couleur inconnue", async () => {
    await expect(createLabel(actor, { name: "   " })).rejects.toMatchObject({ code: "validation" });
    await expect(createLabel(actor, { name: "x".repeat(41) })).rejects.toMatchObject({
      code: "validation",
    });
    await expect(createLabel(actor, { name: "OK", color: "#ff0000" })).rejects.toMatchObject({
      code: "validation",
    });
  });

  it("refuse deux libellés homonymes chez le même utilisateur", async () => {
    await createLabel(actor, { name: "Clients" });
    await expect(createLabel(actor, { name: "Clients" })).rejects.toMatchObject({
      code: "conflict",
    });
    // Un autre utilisateur peut avoir le même nom : les libellés sont personnels.
    await expect(createLabel(other, { name: "Clients" })).resolves.toMatchObject({
      name: "Clients",
    });
  });

  it("supprime un libellé et retire l'étiquette des messages", async () => {
    const label = await createLabel(actor, { name: "Clients" });
    const messageId = await insertMessage({ subject: "Devis" });
    await setMessageLabels(actor, messageId, [label.id]);
    expect((await getMessage(actor, messageId)).labels).toHaveLength(1);

    await deleteLabel(actor, label.id);
    expect(await listLabels(actor)).toHaveLength(0);
    // Le message survit, sans son libellé.
    const detail = await getMessage(actor, messageId);
    expect(detail.subject).toBe("Devis");
    expect(detail.labels).toEqual([]);
    expect(
      (
        await getDb()
          .select()
          .from(mailMessageLabels)
          .where(eq(mailMessageLabels.messageId, messageId))
      ).length,
    ).toBe(0);
  });

  it("ne laisse jamais un utilisateur toucher le libellé d'un autre", async () => {
    const label = await createLabel(actor, { name: "Privé" });
    const messageId = await insertMessage({ subject: "Secret" });

    await expect(updateLabel(other, { id: label.id, name: "Volé" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(deleteLabel(other, label.id)).rejects.toMatchObject({ code: "not_found" });
    // Le message d'Alice est hors de portée pour Bruno : la boîte est vérifiée
    // avant les libellés, donc « introuvable » et non « invalide ».
    await expect(setMessageLabels(other, messageId, [label.id])).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(setMessageLabels(actor, messageId, [randomUUID()])).rejects.toMatchObject({
      code: "validation",
    });
  });

  it("journalise la création et la suppression, jamais la lecture", async () => {
    const label = await createLabel(actor, { name: "Audité" });
    await listLabels(actor);
    await deleteLabel(actor, label.id);

    const events = await getDb().select().from(auditEvents).where(eq(auditEvents.orgId, orgId));
    const actions = events.map((event) => event.action);
    expect(actions).toContain("mail.label.create");
    expect(actions).toContain("mail.label.delete");
    expect(actions).not.toContain("mail.label.list");
  });
});

describe("libellés — application et listes", () => {
  it("applique un ensemble exact de libellés (ajouts et retraits)", async () => {
    const clients = await createLabel(actor, { name: "Clients" });
    const urgent = await createLabel(actor, { name: "Urgent" });
    const factures = await createLabel(actor, { name: "Factures" });
    const messageId = await insertMessage({ subject: "Devis" });

    let applied = await setMessageLabels(actor, messageId, [clients.id, urgent.id]);
    expect(applied.map((label) => label.name)).toEqual(["Clients", "Urgent"]);

    // Réappliquer le même ensemble ne duplique rien.
    applied = await setMessageLabels(actor, messageId, [clients.id, urgent.id]);
    expect(applied.map((label) => label.name)).toEqual(["Clients", "Urgent"]);
    const detail = await getMessage(actor, messageId);
    expect(detail.labels).toHaveLength(2);

    // Retirer « Urgent », ajouter « Factures ».
    applied = await setMessageLabels(actor, messageId, [clients.id, factures.id]);
    expect(applied.map((label) => label.name)).toEqual(["Clients", "Factures"]);

    // Tout retirer.
    expect(await setMessageLabels(actor, messageId, [])).toEqual([]);
    expect((await getMessage(actor, messageId)).labels).toEqual([]);
  });

  it("borne les libellés par message et par utilisateur", async () => {
    const labels = await Promise.all(
      Array.from({ length: 6 }, (_, index) => createLabel(actor, { name: `L${index}` })),
    );
    const messageId = await insertMessage({ subject: "Trop" });
    await expect(
      setMessageLabels(
        actor,
        messageId,
        labels.map((label) => label.id),
      ),
    ).rejects.toMatchObject({ code: "validation" });

    await expect(
      setMessageLabels(actor, messageId, [labels[0]?.id ?? "", labels[0]?.id ?? ""]),
    ).resolves.toHaveLength(1);
  });

  it("expose les libellés dans la liste et dans les fils", async () => {
    const clients = await createLabel(actor, { name: "Clients" });
    const first = await insertMessage({ subject: "Projet", threadKey: "projet", body: "Premier" });
    const second = await insertMessage({
      subject: "Re: Projet",
      threadKey: "projet",
      body: "Second",
      createdAt: new Date(Date.now() + 1000),
    });
    await setMessageLabels(actor, first, [clients.id]);

    const flat = await listMessages(actor, { folder: "inbox" });
    const first_ = flat.find((message) => message.id === first);
    const second_ = flat.find((message) => message.id === second);
    expect(first_?.labels.map((label) => label.name)).toEqual(["Clients"]);
    expect(second_?.labels).toEqual([]);

    // Un fil porte l'union des libellés de ses messages.
    const threads = await listMessages(actor, { folder: "inbox", threaded: true });
    expect(threads).toHaveLength(1);
    expect(threads[0]?.labels.map((label) => label.name)).toEqual(["Clients"]);
    expect(threads[0]?.messageCount).toBe(2);
    expect(second).toBeTruthy();
  });

  it("compte les messages par libellé, non lus compris", async () => {
    const clients = await createLabel(actor, { name: "Clients" });
    const unread = await insertMessage({ subject: "Non lu" });
    const read = await insertMessage({ subject: "Lu", readAt: new Date() });
    const archived = await insertMessage({ subject: "Archivé", folder: "archive" });
    await setMessageLabels(actor, unread, [clients.id]);
    await setMessageLabels(actor, read, [clients.id]);
    await setMessageLabels(actor, archived, [clients.id]);

    const counts = await listLabelCounts(actor);
    expect(counts[clients.id]).toEqual({ total: 3, unread: 1 });
  });

  it("filtre la liste par libellé, sans mélanger les libellés d'autrui", async () => {
    const clients = await createLabel(actor, { name: "Clients" });
    const otherLabel = await createLabel(other, { name: "Clients" });
    expect(otherLabel.id).not.toBe(clients.id);

    const mine = await insertMessage({ subject: "À moi" });
    const theirs = await insertMessage({ subject: "Pas à moi" });
    await setMessageLabels(actor, mine, [clients.id]);

    // Le libellé de Bruno ne doit rien ramener dans la boîte d'Alice.
    expect(await listMessages(actor, { folder: "inbox", labelId: otherLabel.id })).toHaveLength(0);
    const filtered = await listMessages(actor, { folder: "inbox", labelId: clients.id });
    expect(filtered.map((message) => message.id)).toEqual([mine]);
    expect(theirs).toBeTruthy();
  });

  it("conserve les libellés d'un brouillon envoyé", async () => {
    const clients = await createLabel(actor, { name: "Clients" });
    const draft = await saveDraft(actor, {
      to: ["bruno@example.org"],
      cc: [],
      subject: "Brouillon étiqueté",
      body: "x",
    });
    await setMessageLabels(actor, draft.id, [clients.id]);
    await sendMail(actor, {
      id: draft.id,
      to: ["bruno@example.org"],
      cc: [],
      subject: "Brouillon étiqueté",
      body: "x",
    });

    const sent = await listMessages(actor, { folder: "sent" });
    expect(sent).toHaveLength(1);
    // Le message envoyé est une nouvelle ligne : ses libellés ne sont pas
    // reportés automatiquement (l'étiquette se repose au besoin).
    expect(sent[0]?.labels).toEqual([]);
    expect(isMailError(null)).toBe(false);
  });
});

describe("conversations — actions sur le fil", () => {
  it("marque comme lus tous les messages du fil", async () => {
    const base = Date.now();
    const first = await insertMessage({
      subject: "Projet",
      threadKey: "projet",
      body: "Premier",
      createdAt: new Date(base - 2000),
    });
    const second = await insertMessage({
      subject: "Re: Projet",
      threadKey: "projet",
      body: "Second",
      createdAt: new Date(base - 1000),
    });
    // Autre fil, qui doit rester non lu.
    await insertMessage({ subject: "Autre", threadKey: "autre", createdAt: new Date(base) });

    const { updated } = await markThreadRead(actor, second);
    expect(updated).toBe(2);

    const threads = await listMessages(actor, { folder: "inbox", threaded: true });
    const projet = threads.find((thread) => thread.threadKey === "projet");
    const autre = threads.find((thread) => thread.threadKey === "autre");
    expect(projet?.unreadCount).toBe(0);
    expect(autre?.unreadCount).toBe(1);
    expect(first).toBeTruthy();
  });

  it("ne marque rien quand le fil est déjà lu", async () => {
    const messageId = await insertMessage({ readAt: new Date() });
    expect((await markThreadRead(actor, messageId)).updated).toBe(0);
  });

  it("ne traverse jamais les boîtes", async () => {
    const messageId = await insertMessage({ subject: "Privé" });
    await expect(markThreadRead(other, messageId)).rejects.toMatchObject({ code: "not_found" });
  });

  it("isole les fils par dossier", async () => {
    await insertMessage({ subject: "Projet", threadKey: "projet", folder: "inbox" });
    await insertMessage({ subject: "Re: Projet", threadKey: "projet", folder: "sent" });

    // Marquer le fil de la boîte ne touche pas celui des « Envoyés ».
    const inbox = await listMessages(actor, { folder: "inbox", threaded: true });
    expect(inbox).toHaveLength(1);
    expect((await markThreadRead(actor, inbox[0]?.latest.id ?? "")).updated).toBe(1);

    const sent = await listMessages(actor, { folder: "sent", threaded: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.unreadCount).toBe(1);
  });
});

describe("filtres — requêtes combinées", () => {
  it("filtre par expéditeur", async () => {
    await insertMessage({ fromAddress: "amine@exemple.org", subject: "Devis" });
    await insertMessage({ fromAddress: "bruno@exemple.org", subject: "Facture" });

    const found = await listMessages(actor, { folder: "inbox", from: "AMINE@exemple.org" });
    expect(found.map((message) => message.subject)).toEqual(["Devis"]);
    expect(await listMessages(actor, { folder: "inbox", from: "inconnu@x.org" })).toHaveLength(0);
  });

  it("filtre par destinataire, élément par élément", async () => {
    await insertMessage({ toAddresses: [box, "second@exemple.org"], subject: "Multi" });
    await insertMessage({ toAddresses: ["autre@exemple.org"], subject: "Seul" });

    expect(
      (await listMessages(actor, { folder: "inbox", to: "second@exemple.org" })).map(
        (message) => message.subject,
      ),
    ).toEqual(["Multi"]);
    // La saisie peut être partielle : « second » trouve « second@exemple.org ».
    expect(
      (await listMessages(actor, { folder: "inbox", to: "second" })).map(
        (message) => message.subject,
      ),
    ).toEqual(["Multi"]);
  });

  it("croise expéditeur, destinataire et non lus", async () => {
    await insertMessage({
      fromAddress: "amine@exemple.org",
      toAddresses: ["client@exemple.org"],
      subject: "Avec pièce",
    });
    await insertMessage({
      fromAddress: "amine@exemple.org",
      toAddresses: ["client@exemple.org"],
      subject: "Sans pièce",
      readAt: new Date(),
    });
    await insertMessage({
      fromAddress: "bruno@exemple.org",
      toAddresses: ["client@exemple.org"],
      subject: "Autre expéditeur",
    });

    const list = await listMessages(actor, {
      folder: "inbox",
      from: "amine@exemple.org",
      to: "client@exemple.org",
      unreadOnly: true,
    });
    expect(list.map((message) => message.subject)).toEqual(["Avec pièce"]);
  });

  it("ne garde que les messages portant une pièce jointe", async () => {
    const withFile = await insertMessage({ subject: "Avec pièce" });
    await insertMessage({ subject: "Sans pièce" });

    const token = await uploadMailAttachment(actor, {
      filename: "note.txt",
      contentType: "text/plain",
      body: Buffer.from("contenu"),
    });
    await getDb()
      .insert((await import("../src/schema.ts")).mailAttachments)
      .values({
        messageId: withFile,
        storageKey: token.storageKey,
        filename: token.filename,
        contentType: token.contentType,
        sizeBytes: token.sizeBytes,
      });

    const list = await listMessages(actor, { folder: "inbox", hasAttachment: true });
    expect(list.map((message) => message.subject)).toEqual(["Avec pièce"]);
    expect(list[0]?.attachmentCount).toBe(1);
  });

  it("combine recherche plein texte et filtres", async () => {
    await insertMessage({
      fromAddress: "amine@exemple.org",
      subject: "Devis 2026",
      body: "Relance du devis",
    });
    await insertMessage({
      fromAddress: "bruno@exemple.org",
      subject: "Devis annulé",
      body: "Sans objet",
    });

    const list = await listMessages(actor, {
      folder: "inbox",
      query: "devis",
      from: "amine@exemple.org",
    });
    expect(list.map((message) => message.subject)).toEqual(["Devis 2026"]);
  });

  it("échappe les jokers dans les filtres « De » et « À »", async () => {
    await insertMessage({ fromAddress: "amine@exemple.org", subject: "Pourcent" });
    await insertMessage({ fromAddress: "bruno@exemple.org", subject: "Sans" });

    // « % » tout seul ne doit pas devenir « tout trouver » : le joker est du
    // texte littéral, comme dans la recherche plein texte.
    expect(await listMessages(actor, { folder: "inbox", from: "%" })).toHaveLength(0);
    expect(await listMessages(actor, { folder: "inbox", to: "%_" })).toHaveLength(0);
    // En revanche, la recherche partielle reste possible.
    expect(
      (await listMessages(actor, { folder: "inbox", from: "amine" })).map(
        (message) => message.subject,
      ),
    ).toEqual(["Pourcent"]);
  });

  it("applique les filtres aux fils comme aux messages plats", async () => {
    await insertMessage({
      subject: "Projet",
      threadKey: "projet",
      fromAddress: "amine@exemple.org",
      createdAt: new Date(Date.now() - 2000),
    });
    await insertMessage({
      subject: "Re: Projet",
      threadKey: "projet",
      fromAddress: "amine@exemple.org",
      createdAt: new Date(Date.now() - 1000),
    });
    await insertMessage({
      subject: "Autre",
      threadKey: "autre",
      fromAddress: "bruno@exemple.org",
    });

    const threads = await listMessages(actor, {
      folder: "inbox",
      from: "amine@exemple.org",
      threaded: true,
    });
    expect(threads).toHaveLength(1);
    expect(threads[0]?.messageCount).toBe(2);
  });
});
