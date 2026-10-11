import { randomUUID } from "node:crypto";
import { getServerEnv } from "@workspace/config";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createInboundMessage,
  deleteMessage,
  ensureMailbox,
  getMessage,
  isMailError,
  listFolders,
  listMessages,
  MAX_INBOUND_BODY_LENGTH,
  MailError,
  restoreMessage,
  saveDraft,
  sendMail,
  toggleStar,
  trashMessage,
} from "../src/index.ts";
import { mailMailboxes, mailMessages } from "../src/schema.ts";

const { user, organization } = coreSchema;

let counter = 0;
const tag = (prefix: string) => `${prefix}${++counter}_${randomUUID().slice(0, 8)}`;

type Fixtures = {
  orgId: string;
  otherOrgId: string;
  actorAlice: Actor;
  actorBruno: Actor;
  actorChloe: Actor;
  actorCollisionA: Actor;
  actorCollisionB: Actor;
  collisionLocal: string;
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

  const makeUser = async (name: string, email?: string) => {
    const id = tag("usr");
    await db.insert(user).values({
      id,
      name,
      email: email ?? `${id}@example.org`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  };

  const alice = await makeUser("Alice");
  const bruno = await makeUser("Bruno");
  const chloe = await makeUser("Chloe");

  // Deux comptes dont l'adresse dérive du même préfixe local.
  const collisionLocal = tag("collision");
  const collisionA = await makeUser("Collision A", `${collisionLocal}@first.example`);
  const collisionB = await makeUser("Collision B", `${collisionLocal}@second.example`);

  return {
    orgId,
    otherOrgId,
    actorAlice: { userId: alice, orgId },
    actorBruno: { userId: bruno, orgId },
    actorChloe: { userId: chloe, orgId: otherOrgId },
    actorCollisionA: { userId: collisionA, orgId },
    actorCollisionB: { userId: collisionB, orgId },
    collisionLocal,
  };
}

async function cleanup(f: Fixtures): Promise<void> {
  const db = getDb();
  await db.delete(organization).where(eq(organization.id, f.orgId));
  await db.delete(organization).where(eq(organization.id, f.otherOrgId));
  await db.delete(user).where(eq(user.id, f.actorAlice.userId));
  await db.delete(user).where(eq(user.id, f.actorBruno.userId));
  await db.delete(user).where(eq(user.id, f.actorChloe.userId));
  await db.delete(user).where(eq(user.id, f.actorCollisionA.userId));
  await db.delete(user).where(eq(user.id, f.actorCollisionB.userId));
}

/** Insère un message directement (fixture) et retourne son id. */
async function insertMessage(
  actor: Actor,
  values: Partial<typeof mailMessages.$inferInsert> = {},
): Promise<string> {
  const box = await ensureMailbox(actor);
  const [created] = await getDb()
    .insert(mailMessages)
    .values({
      orgId: actor.orgId,
      mailboxId: box.id,
      folder: "inbox",
      fromAddress: "ami@example.org",
      toAddresses: [box.address],
      subject: "Sujet",
      body: "Corps",
      ...values,
    })
    .returning({ id: mailMessages.id });
  if (!created) throw new Error("insertion impossible");
  return created.id;
}

function webhookSecret(): string {
  const secret = getServerEnv().MAIL_WEBHOOK_SECRET;
  if (!secret) throw new Error("MAIL_WEBHOOK_SECRET est requis pour les tests d'ingestion.");
  return secret;
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

describe("mail — boîtes", () => {
  it("crée la boîte une seule fois, adresse dérivée du compte", async () => {
    const first = await ensureMailbox(f.actorAlice);
    const second = await ensureMailbox(f.actorAlice);
    expect(second.id).toBe(first.id);
    expect(first.address).toContain("@");
    expect(first.address.startsWith(f.actorAlice.userId.slice(0, 5))).toBe(true);

    const brunoBox = await ensureMailbox(f.actorBruno);
    expect(brunoBox.address).not.toBe(first.address);
  });

  it("suffixe l'adresse quand deux comptes partagent le même préfixe local", async () => {
    const first = await ensureMailbox(f.actorCollisionA);
    const second = await ensureMailbox(f.actorCollisionB);

    const [local, domain] = first.address.split("@");
    expect(local).toBe(f.collisionLocal);
    expect(second.address).toBe(`${local}2@${domain}`);
  });

  it("échoue avec conflict quand toutes les variantes d'adresse sont prises", async () => {
    const db = getDb();
    const domain = (await ensureMailbox(f.actorAlice)).address.split("@")[1] ?? "";
    const local = tag("sature");
    const victimId = tag("usr");
    const holderIds = Array.from({ length: 30 }, () => tag("usr"));
    const now = new Date();

    try {
      await db.insert(user).values([
        {
          id: victimId,
          name: "Victime",
          email: `${local}@victim.example`,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
        ...holderIds.map((id) => ({
          id,
          name: id,
          email: `${id}@example.org`,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        })),
      ]);
      await db.insert(mailMailboxes).values(
        holderIds.map((userId, index) => ({
          orgId: f.orgId,
          userId,
          address: index === 0 ? `${local}@${domain}` : `${local}${index + 1}@${domain}`,
        })),
      );

      await expect(ensureMailbox({ userId: victimId, orgId: f.orgId })).rejects.toMatchObject({
        code: "conflict",
      });
    } finally {
      await db.delete(user).where(inArray(user.id, [victimId, ...holderIds]));
    }
  });

  it("crée la boîte à la volée : boîte de réception vide au premier accès", async () => {
    expect(await listMessages(f.actorBruno)).toEqual([]);
    expect(await listFolders(f.actorBruno)).toEqual({
      inbox: { total: 0, unread: 0 },
      sent: { total: 0, unread: 0 },
      drafts: { total: 0, unread: 0 },
      trash: { total: 0, unread: 0 },
    });
  });
});

describe("mail — envoi et brouillons", () => {
  it("conserve l'envoi dans « Envoyés » avec une erreur visible sans SMTP", async () => {
    const result = await sendMail(f.actorAlice, {
      to: ["bruno@example.org"],
      cc: [],
      subject: "Bonjour",
      body: "Contenu",
    });
    expect(result.sendError).toContain("SMTP non configuré");

    const sent = await listMessages(f.actorAlice, { folder: "sent" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe("Bonjour");
    expect(sent[0]?.sendError).toContain("SMTP non configuré");
  });

  it("enregistre, met à jour un brouillon et le convertit en envoi", async () => {
    const draft = await saveDraft(f.actorAlice, {
      to: ["bruno@example.org"],
      cc: [],
      subject: "Brouillon",
      body: "Premier jet",
    });
    await saveDraft(f.actorAlice, {
      id: draft.id,
      to: ["bruno@example.org"],
      cc: ["chloe@example.org"],
      subject: "Brouillon v2",
      body: "Second jet",
    });
    let drafts = await listMessages(f.actorAlice, { folder: "drafts" });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.subject).toBe("Brouillon v2");

    await sendMail(f.actorAlice, {
      id: draft.id,
      to: ["bruno@example.org"],
      cc: [],
      subject: "Brouillon v2",
      body: "Second jet",
    });
    drafts = await listMessages(f.actorAlice, { folder: "drafts" });
    expect(drafts).toHaveLength(0);
    expect(await listMessages(f.actorAlice, { folder: "sent" })).toHaveLength(1);
  });

  it("refuse d'envoyer un identifiant qui n'est pas un brouillon, sans écrire dans « Envoyés »", async () => {
    const brunoDraft = await saveDraft(f.actorBruno, {
      to: ["alice@example.org"],
      cc: [],
      subject: "Brouillon de Bruno",
      body: "x",
    });
    const aliceDraft = await saveDraft(f.actorAlice, {
      to: ["bruno@example.org"],
      cc: [],
      subject: "Brouillon d'Alice",
      body: "x",
    });
    await trashMessage(f.actorAlice, aliceDraft.id);

    const attempt = async (id: string) => {
      try {
        await sendMail(f.actorAlice, {
          id,
          to: ["bruno@example.org"],
          cc: [],
          subject: "Envoi",
          body: "Contenu",
        });
        return null;
      } catch (error) {
        return error;
      }
    };

    const foreign = await attempt(brunoDraft.id);
    expect(isMailError(foreign)).toBe(true);
    if (isMailError(foreign)) expect(foreign.code).toBe("not_found");

    const missing = await attempt(randomUUID());
    expect(isMailError(missing)).toBe(true);
    if (isMailError(missing)) expect(missing.code).toBe("not_found");

    const trashed = await attempt(aliceDraft.id);
    expect(isMailError(trashed)).toBe(true);
    if (isMailError(trashed)) {
      expect(trashed.code).toBe("validation");
      expect(trashed.message).toContain("Seul un brouillon");
    }

    expect(await listMessages(f.actorAlice, { folder: "sent" })).toHaveLength(0);
    expect(await listMessages(f.actorAlice, { folder: "drafts" })).toHaveLength(0);
    expect(await listMessages(f.actorBruno, { folder: "drafts" })).toHaveLength(1);
  });

  it("valide les destinataires", async () => {
    await expect(sendMail(f.actorAlice, { to: [], cc: [], subject: "", body: "" })).rejects.toThrow(
      MailError,
    );
    await expect(
      sendMail(f.actorAlice, { to: ["pas-un-email"], cc: [], subject: "", body: "" }),
    ).rejects.toThrow(MailError);
  });

  it("borne l'union to + cc à 20 destinataires distincts", async () => {
    const tooManyTo = Array.from({ length: 11 }, (_, index) => `to${index}@example.org`);
    const tooManyCc = Array.from({ length: 10 }, (_, index) => `cc${index}@example.org`);
    await expect(
      saveDraft(f.actorAlice, { to: tooManyTo, cc: tooManyCc, subject: "Trop", body: "" }),
    ).rejects.toThrow(MailError);

    // Les doublons entre to et cc ne comptent qu'une fois.
    const distinct = Array.from({ length: 20 }, (_, index) => `d${index}@example.org`);
    const draft = await saveDraft(f.actorAlice, {
      to: distinct,
      cc: distinct.slice(0, 5),
      subject: "OK",
      body: "Corps",
    });
    const detail = await getMessage(f.actorAlice, draft.id);
    expect(detail.toAddresses).toHaveLength(20);
    expect(detail.ccAddresses).toHaveLength(5);
  });

  it("refuse les objets et corps trop volumineux au lieu de les tronquer", async () => {
    const oversizedSubject = "a".repeat(501);
    const oversizedBody = "a".repeat(100_001);

    await expect(
      saveDraft(f.actorAlice, {
        to: ["bruno@example.org"],
        cc: [],
        subject: oversizedSubject,
        body: "x",
      }),
    ).rejects.toThrow(MailError);
    await expect(
      saveDraft(f.actorAlice, {
        to: ["bruno@example.org"],
        cc: [],
        subject: "ok",
        body: oversizedBody,
      }),
    ).rejects.toThrow(MailError);
    await expect(
      sendMail(f.actorAlice, {
        to: ["bruno@example.org"],
        cc: [],
        subject: oversizedSubject,
        body: "x",
      }),
    ).rejects.toThrow(MailError);
    await expect(
      sendMail(f.actorAlice, {
        to: ["bruno@example.org"],
        cc: [],
        subject: "ok",
        body: oversizedBody,
      }),
    ).rejects.toThrow(MailError);

    expect(await listMessages(f.actorAlice, { folder: "drafts" })).toHaveLength(0);
    expect(await listMessages(f.actorAlice, { folder: "sent" })).toHaveLength(0);

    // Les bornes exactes restent acceptées.
    const draft = await saveDraft(f.actorAlice, {
      to: ["bruno@example.org"],
      cc: [],
      subject: "a".repeat(500),
      body: "b".repeat(100_000),
    });
    expect(draft.id).toBeTruthy();
  });
});

describe("mail — lecture et corbeille", () => {
  it("marque comme lu à l'ouverture et gère les filtres et le suivi", async () => {
    const box = await ensureMailbox(f.actorAlice);
    const messageId = await insertMessage(f.actorAlice, { body: "Ça va ?" });

    let inbox = await listFolders(f.actorAlice);
    expect(inbox.inbox.unread).toBe(1);
    expect(inbox.inbox.total).toBe(1);

    const message = await listMessages(f.actorAlice, { folder: "inbox" });
    const first = message[0];
    if (!first) throw new Error("message manquant");
    expect(first.id).toBe(messageId);
    expect(first.snippet).toBe("Ça va ?");
    expect(first.toAddresses).toEqual([box.address]);
    await getMessage(f.actorAlice, first.id);

    inbox = await listFolders(f.actorAlice);
    expect(inbox.inbox.unread).toBe(0);

    await toggleStar(f.actorAlice, first.id);
    expect(await listMessages(f.actorAlice, { folder: "inbox", starredOnly: true })).toHaveLength(
      1,
    );
    expect(await listMessages(f.actorAlice, { folder: "inbox", unreadOnly: true })).toHaveLength(0);
  });

  it("bascule l'étoile dans les deux sens", async () => {
    const messageId = await insertMessage(f.actorAlice);
    expect((await toggleStar(f.actorAlice, messageId)).starred).toBe(true);
    expect((await toggleStar(f.actorAlice, messageId)).starred).toBe(false);
    await expect(toggleStar(f.actorBruno, messageId)).rejects.toThrow(MailError);
  });

  it("ne compte les non-lus que dans la boîte de réception", async () => {
    const box = await ensureMailbox(f.actorAlice);
    await getDb()
      .insert(mailMessages)
      .values([
        {
          orgId: f.orgId,
          mailboxId: box.id,
          folder: "inbox",
          fromAddress: "ami@example.org",
          toAddresses: [box.address],
          subject: "Inbox",
          body: "x",
        },
        {
          orgId: f.orgId,
          mailboxId: box.id,
          folder: "sent",
          fromAddress: box.address,
          toAddresses: ["bruno@example.org"],
          subject: "Sent",
          body: "x",
        },
        {
          orgId: f.orgId,
          mailboxId: box.id,
          folder: "drafts",
          fromAddress: box.address,
          toAddresses: [],
          subject: "Draft",
          body: "x",
        },
        {
          orgId: f.orgId,
          mailboxId: box.id,
          folder: "trash",
          fromAddress: "ami@example.org",
          toAddresses: [box.address],
          subject: "Trash",
          body: "x",
        },
      ]);

    const counts = await listFolders(f.actorAlice);
    expect(counts.inbox).toEqual({ total: 1, unread: 1 });
    expect(counts.sent).toEqual({ total: 1, unread: 0 });
    expect(counts.drafts).toEqual({ total: 1, unread: 0 });
    expect(counts.trash).toEqual({ total: 1, unread: 0 });
  });

  it("traite les jokers ILIKE comme du texte littéral", async () => {
    await insertMessage(f.actorAlice, { subject: "Remise 100%" });
    await insertMessage(f.actorAlice, { subject: "Remise 100x" });
    await insertMessage(f.actorAlice, { subject: "Sans joker" });

    const percent = await listMessages(f.actorAlice, { folder: "inbox", query: "%" });
    expect(percent.map((message) => message.subject)).toEqual(["Remise 100%"]);

    const underscore = await listMessages(f.actorAlice, { folder: "inbox", query: "_" });
    expect(underscore).toHaveLength(0);
  });

  it("limite l'extrait de liste sans charger le corps complet", async () => {
    const messageId = await insertMessage(f.actorAlice, {
      subject: "Long",
      body: `${"x".repeat(500)}FIN`,
    });
    const [summary] = await listMessages(f.actorAlice, { folder: "inbox" });
    expect(summary?.id).toBe(messageId);
    expect(summary?.snippet).toBe("x".repeat(160));

    const detail = await getMessage(f.actorAlice, messageId);
    expect(detail.body.endsWith("FIN")).toBe(true);
  });

  it("corbeille, restauration puis suppression définitive", async () => {
    const messageId = await insertMessage(f.actorAlice, { subject: "À jeter" });

    await trashMessage(f.actorAlice, messageId);
    expect(await listMessages(f.actorAlice, { folder: "trash" })).toHaveLength(1);

    await restoreMessage(f.actorAlice, messageId);
    expect(await listMessages(f.actorAlice, { folder: "inbox" })).toHaveLength(1);

    await expect(deleteMessage(f.actorAlice, messageId)).rejects.toThrow(MailError);
    await trashMessage(f.actorAlice, messageId);
    await deleteMessage(f.actorAlice, messageId);
    expect(await listMessages(f.actorAlice, { folder: "trash" })).toHaveLength(0);
  });

  it("ne franchit jamais les boîtes ni l'organisation", async () => {
    const messageId = await insertMessage(f.actorAlice, { subject: "Privé" });
    await expect(trashMessage(f.actorBruno, messageId)).rejects.toThrow(MailError);
    await expect(trashMessage(f.actorChloe, messageId)).rejects.toThrow(MailError);
  });
});

describe("mail — ingestion entrante", () => {
  it("refuse sans secret valide", async () => {
    const box = await ensureMailbox(f.actorAlice);
    await expect(
      createInboundMessage(
        { to: box.address, from: "expediteur@example.org", subject: "Test", body: "Corps" },
        null,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      createInboundMessage(
        { to: box.address, from: "expediteur@example.org", subject: "Test", body: "Corps" },
        "mauvais-secret",
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("accepte un message entrant avec un secret valide", async () => {
    const box = await ensureMailbox(f.actorAlice);
    const created = await createInboundMessage(
      {
        to: box.address,
        from: "Expediteur@Example.org",
        fromName: "Expéditeur",
        subject: "Reçu",
        body: "Corps",
      },
      webhookSecret(),
    );

    const inbox = await listMessages(f.actorAlice, { folder: "inbox" });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.id).toBe(created.id);
    expect(inbox[0]?.fromAddress).toBe("expediteur@example.org");
    expect(await listFolders(f.actorAlice)).toMatchObject({
      inbox: { total: 1, unread: 1 },
    });
  });

  it("rend l'ingestion idempotente grâce à l'externalId", async () => {
    const box = await ensureMailbox(f.actorAlice);
    const payload = {
      to: box.address,
      from: "expediteur@example.org",
      subject: "Rejoué",
      body: "Corps",
      externalId: `msg-${randomUUID()}`,
    };

    const first = await createInboundMessage(payload, webhookSecret());
    const second = await createInboundMessage(payload, webhookSecret());
    expect(second.id).toBe(first.id);
    expect(await listMessages(f.actorAlice, { folder: "inbox" })).toHaveLength(1);
  });

  it("refuse un corps de plus de 1 Mo", async () => {
    const box = await ensureMailbox(f.actorAlice);
    await expect(
      createInboundMessage(
        {
          to: box.address,
          from: "expediteur@example.org",
          subject: "Gros",
          body: "a".repeat(MAX_INBOUND_BODY_LENGTH + 1),
        },
        webhookSecret(),
      ),
    ).rejects.toMatchObject({ code: "validation" });
    expect(await listMessages(f.actorAlice, { folder: "inbox" })).toHaveLength(0);
  });

  it("refuse une boîte inconnue", async () => {
    await expect(
      createInboundMessage(
        { to: "inconnue@example.org", from: "expediteur@example.org", subject: "x", body: "x" },
        webhookSecret(),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
