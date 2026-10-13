import { randomUUID } from "node:crypto";
import { schema as coreSchema, getDb } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureMailbox,
  getMessage,
  isMailError,
  listMessages,
  MailError,
  saveDraft,
  sendMail,
} from "../src/index.ts";

const { user, organization } = coreSchema;

let counter = 0;
const tag = (prefix: string) => `${prefix}${++counter}_${randomUUID().slice(0, 8)}`;

let orgId = "";
let actor: Actor;
let mailboxAddress = "";

beforeEach(async () => {
  const db = getDb();
  const now = new Date();
  orgId = tag("org");
  await db
    .insert(organization)
    .values({ id: orgId, name: tag("Org "), slug: orgId, createdAt: now });
  const userId = tag("usr");
  await db.insert(user).values({
    id: userId,
    name: "Alice",
    email: `${userId}@example.org`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  actor = { userId, orgId };
  mailboxAddress = (await ensureMailbox(actor)).address;
});

afterEach(async () => {
  const db = getDb();
  await db.delete(organization).where(eq(organization.id, orgId));
  await db.delete(user).where(eq(user.id, actor.userId));
});

afterAll(async () => {
  const { closeDb } = await import("@workspace/database");
  await closeDb();
});

describe("composition — copies cachées (Cci)", () => {
  it("conserve les Cci avec le message envoyé", async () => {
    const sent = await sendMail(actor, {
      to: ["bruno@example.org"],
      cc: ["chloe@example.org"],
      bcc: ["cache@example.org"],
      subject: "Avec Cci",
      body: "Contenu",
    });

    const detail = await getMessage(actor, sent.id);
    expect(detail.toAddresses).toEqual(["bruno@example.org"]);
    expect(detail.ccAddresses).toEqual(["chloe@example.org"]);
    expect(detail.bccAddresses).toEqual(["cache@example.org"]);
    // Sans SMTP configuré, le message reste visible avec son erreur.
    expect(detail.sendError).toContain("SMTP");
  });

  it("laisse les Cci vides quand le champ n'est pas rempli", async () => {
    const sent = await sendMail(actor, {
      to: ["bruno@example.org"],
      cc: [],
      subject: "Sans Cci",
      body: "Contenu",
    });
    const detail = await getMessage(actor, sent.id);
    expect(detail.bccAddresses).toEqual([]);
  });

  it("conserve les Cci d'un brouillon et les met à jour", async () => {
    const draft = await saveDraft(actor, {
      to: ["bruno@example.org"],
      cc: [],
      bcc: ["cache@example.org"],
      subject: "Brouillon Cci",
      body: "Premier jet",
    });
    let detail = await getMessage(actor, draft.id);
    expect(detail.bccAddresses).toEqual(["cache@example.org"]);

    await saveDraft(actor, {
      id: draft.id,
      to: ["bruno@example.org"],
      cc: [],
      bcc: [],
      subject: "Brouillon Cci",
      body: "Second jet",
    });
    detail = await getMessage(actor, draft.id);
    expect(detail.bccAddresses).toEqual([]);
  });

  it("valide les Cci comme les autres destinataires", async () => {
    await expect(
      sendMail(actor, {
        to: ["bruno@example.org"],
        cc: [],
        bcc: ["pas-un-email"],
        subject: "Invalide",
        body: "x",
      }),
    ).rejects.toThrow(MailError);
    // Rien n'est écrit dans « Envoyés » quand la validation échoue.
    expect(await listMessages(actor, { folder: "sent", threaded: false })).toHaveLength(0);
  });

  it("compte les Cci dans la limite de 20 destinataires distincts", async () => {
    const tooMany = Array.from({ length: 21 }, (_, index) => `d${index}@example.org`);
    await expect(
      saveDraft(actor, { to: [], cc: [], bcc: tooMany, subject: "Trop", body: "" }),
    ).rejects.toMatchObject({ code: "validation" });

    const distinct = Array.from({ length: 20 }, (_, index) => `d${index}@example.org`);
    const draft = await saveDraft(actor, {
      to: distinct.slice(0, 10),
      cc: [],
      bcc: distinct.slice(0, 10),
      subject: "Limite exacte",
      body: "Corps",
    });
    const detail = await getMessage(actor, draft.id);
    expect(detail.toAddresses).toHaveLength(10);
    expect(detail.bccAddresses).toHaveLength(10);
  });

  it("accepte la borne exacte et dédoublonne entre champs", async () => {
    const twenty = Array.from({ length: 20 }, (_, index) => `u${index}@example.org`);
    const draft = await saveDraft(actor, {
      to: twenty,
      cc: [],
      bcc: twenty,
      subject: "Mêmes destinataires",
      body: "Corps",
    });
    const detail = await getMessage(actor, draft.id);
    expect(detail.toAddresses).toHaveLength(20);
    expect(detail.bccAddresses).toHaveLength(20);
    expect(isMailError(null)).toBe(false);
    expect(mailboxAddress).toContain("@");
  });
});
