import { randomUUID } from "node:crypto";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addChannelMember,
  archiveChannel,
  chatChannels,
  chatPins,
  createChannel,
  getUnreadState,
  joinChannel,
  listChannelMembers,
  listChannels,
  listJoinableChannels,
  listMessages,
  listPins,
  markRead,
  pinMessage,
  restoreChannel,
  sendMessage,
  startDm,
  unpinMessage,
  uploadChatAttachment,
} from "../src/index.ts";
import { unreadShown, unreadSplitIndex } from "../src/ui/unread.ts";

const { user, organization, member, auditEvents } = coreSchema;

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
  await db.delete(organization).where(eq(organization.id, f.orgId));
  await db.delete(organization).where(eq(organization.id, f.otherOrgId));
  for (const id of [f.alice, f.bruno, f.chloe]) {
    await db.delete(user).where(eq(user.id, id));
  }
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

describe("chat — canaux privés et archivage", () => {
  it("crée un canal privé mais ne le montre qu'à ses membres", async () => {
    const channel = await createChannel(f.actorAlice, "confidence", "private");
    await sendMessage(f.actorAlice, channel.id, "secret partagé");

    const aliceView = (await listChannels(f.actorAlice)).find((view) => view.id === channel.id);
    expect(aliceView?.visibility).toBe("private");
    expect(aliceView?.archived).toBe(false);
    expect(aliceView?.memberCount).toBe(1);
    expect(aliceView?.managedByMe).toBe(true);

    // Bruno, dans la même organisation, ne voit rien : pas de ligne, pas de
    // lecture, pas de découverte. Un canal privé n'existe pas pour lui.
    expect((await listChannels(f.actorBruno)).some((view) => view.id === channel.id)).toBe(false);
    await expect(listMessages(f.actorBruno, channel.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(joinChannel(f.actorBruno, channel.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect((await listJoinableChannels(f.actorBruno)).some((view) => view.id === channel.id)).toBe(
      false,
    );

    const rows = await getDb()
      .select({ visibility: chatChannels.visibility })
      .from(chatChannels)
      .where(eq(chatChannels.id, channel.id));
    expect(rows[0]?.visibility).toBe("private");
  });

  it("rend un canal public découvrable et rejoignable", async () => {
    const channel = await createChannel(f.actorAlice, "general-public");
    await sendMessage(f.actorAlice, channel.id, "ouverte à tous");

    const discoverable = await listJoinableChannels(f.actorBruno);
    expect(discoverable.map((view) => view.id)).toContain(channel.id);
    expect(discoverable[0]).toMatchObject({ name: "general-public", memberCount: 1 });
    expect(discoverable[0]?.lastMessageAt).not.toBeNull();

    // L'auteur est déjà membre : son propre canal n'est pas « à rejoindre ».
    expect((await listJoinableChannels(f.actorAlice)).some((view) => view.id === channel.id)).toBe(
      false,
    );

    const joined = await joinChannel(f.actorBruno, channel.id);
    expect(joined).toEqual({ joined: true });
    // Idempotent : un second appel ne compte pas et ne journalise rien.
    expect(await joinChannel(f.actorBruno, channel.id)).toEqual({ joined: false });
    // Dès l'adhésion, le canal disparaît de la découverte.
    expect((await listJoinableChannels(f.actorBruno)).some((view) => view.id === channel.id)).toBe(
      false,
    );

    const brunoView = (await listChannels(f.actorBruno)).find((view) => view.id === channel.id);
    expect(brunoView?.unreadCount).toBe(0);
  });

  it("invite un membre dans un canal privé (membres visibles)", async () => {
    const channel = await createChannel(f.actorAlice, "confidence", "private");

    expect(await addChannelMember(f.actorAlice, channel.id, f.bruno)).toEqual({ added: true });
    // Idempotent.
    expect(await addChannelMember(f.actorAlice, channel.id, f.bruno)).toEqual({ added: false });

    const members = await listChannelMembers(f.actorBruno, channel.id);
    expect(members.map((row) => row.name)).toEqual(["Alice", "Bruno"]);
    expect(members.find((row) => row.name === "Alice")?.creator).toBe(true);
    expect(members.find((row) => row.name === "Bruno")?.creator).toBe(false);

    // Bruno voit maintenant le canal privé, et seulement depuis son invitation :
    // l'historique antérieur n'est pas compté comme non lu.
    const before = (await listChannels(f.actorBruno)).find((view) => view.id === channel.id);
    expect(before?.visibility).toBe("private");
    expect(before?.memberCount).toBe(2);
    expect(before?.unreadCount).toBe(0);

    // Refus : hors organisation, déjà membre, et par un non-créateur.
    await expect(addChannelMember(f.actorAlice, channel.id, f.chloe)).rejects.toMatchObject({
      code: "validation",
    });
    await expect(addChannelMember(f.actorAlice, channel.id, f.alice)).rejects.toMatchObject({
      code: "validation",
    });
    await expect(addChannelMember(f.actorBruno, channel.id, f.chloe)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("archive un canal : historique lisible, écritures coupées", async () => {
    const db = getDb();
    const channel = await createChannel(f.actorAlice, "a-ranger");
    const message = await sendMessage(f.actorAlice, channel.id, "dernier mot");

    await archiveChannel(f.actorAlice, channel.id);

    const [row] = await db
      .select({ archivedAt: chatChannels.archivedAt })
      .from(chatChannels)
      .where(eq(chatChannels.id, channel.id));
    expect(row?.archivedAt).toBeInstanceOf(Date);

    // L'historique reste lisible, et le compteur de non-lus continue de vivre.
    expect((await listMessages(f.actorAlice, channel.id)).map((m) => m.body)).toEqual([
      "dernier mot",
    ]);
    const aliceView = (await listChannels(f.actorAlice)).find((view) => view.id === channel.id);
    expect(aliceView?.archived).toBe(true);

    // Plus d'envoi, plus d'épingle, plus d'invitation, plus d'adhésion.
    await expect(sendMessage(f.actorAlice, channel.id, "trop tard")).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(pinMessage(f.actorAlice, channel.id, message.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(addChannelMember(f.actorAlice, channel.id, f.bruno)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(joinChannel(f.actorBruno, channel.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    // Les canaux archivés ne sont jamais proposés à la découverte.
    expect((await listJoinableChannels(f.actorBruno)).some((v) => v.id === channel.id)).toBe(false);

    // Le marquage comme lu reste permis (on lit une archive).
    await expect(markRead(f.actorAlice, channel.id)).resolves.toBeUndefined();
  });

  it("désarchive un canal et rend les écritures possibles", async () => {
    const channel = await createChannel(f.actorAlice, "a-ranger");
    await archiveChannel(f.actorAlice, channel.id);
    await restoreChannel(f.actorAlice, channel.id);

    const aliceView = (await listChannels(f.actorAlice)).find((view) => view.id === channel.id);
    expect(aliceView?.archived).toBe(false);
    await expect(sendMessage(f.actorAlice, channel.id, "de retour")).resolves.toMatchObject({
      body: "de retour",
    });
  });

  it("réserve l'archivage à la personne qui a créé le canal", async () => {
    const channel = await createChannel(f.actorAlice, "pas-a-toi");
    await addChannelMember(f.actorAlice, channel.id, f.bruno);

    await expect(archiveChannel(f.actorBruno, channel.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(restoreChannel(f.actorBruno, channel.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await archiveChannel(f.actorAlice, channel.id);
    await expect(restoreChannel(f.actorBruno, channel.id)).rejects.toMatchObject({
      code: "forbidden",
    });

    // Bruno reste membre : il lit toujours l'archive.
    expect(
      (await listChannels(f.actorBruno)).find((view) => view.id === channel.id)?.archived,
    ).toBe(true);
  });

  it("refuse d'archiver une discussion directe et les canaux d'une autre organisation", async () => {
    const dm = await startDm(f.actorAlice, f.bruno);
    await expect(archiveChannel(f.actorAlice, dm.id)).rejects.toMatchObject({ code: "validation" });

    const channel = await createChannel(f.actorAlice, "org-only");
    await expect(archiveChannel(f.actorChloe, channel.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(joinChannel(f.actorChloe, channel.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("journalise les faits marquants du canal, jamais les lectures", async () => {
    const channel = await createChannel(f.actorAlice, "journal", "private");
    const opened = await createChannel(f.actorAlice, "ouvert");
    await addChannelMember(f.actorAlice, channel.id, f.bruno);
    await archiveChannel(f.actorAlice, channel.id);
    await restoreChannel(f.actorAlice, channel.id);
    await joinChannel(f.actorBruno, opened.id);
    await sendMessage(f.actorAlice, channel.id, "toujours rien");

    const rows = await getDb().select().from(auditEvents).where(eq(auditEvents.orgId, f.orgId));
    const actions = rows.map((row) => row.action).sort();
    expect(actions).toEqual([
      "chat.channel.archive",
      "chat.channel.create",
      "chat.channel.create",
      "chat.channel.join",
      "chat.channel.member.add",
      "chat.channel.restore",
    ]);
    expect(rows.filter((row) => row.action === "chat.channel.member.add")[0]?.metadata).toEqual({
      userId: f.bruno,
    });
    // La création privée porte la visibilité ; la création publique reste muette.
    const creations = rows.filter((row) => row.action === "chat.channel.create");
    expect(creations.find((row) => row.resourceId === channel.id)?.metadata).toEqual({
      visibility: "private",
    });
    expect(creations.find((row) => row.resourceId === opened.id)?.metadata).toBeNull();
    // Aucune ligne d'envoi : les messages restent muets (volume).
    expect(rows.filter((row) => row.action === "chat.attachment.send")).toHaveLength(0);
  });
});

describe("chat — séparateur de messages non lus", () => {
  it("expose le curseur effectif et le place devant les messages d'autrui", async () => {
    const channel = await createChannel(f.actorAlice, "reprise");
    // Bruno rejoint après ces messages : ils ne sont PAS non lus pour lui.
    await sendMessage(f.actorAlice, channel.id, "ancien 1");
    await sendMessage(f.actorAlice, channel.id, "ancien 2");
    await addChannelMember(f.actorAlice, channel.id, f.bruno);

    expect(await getUnreadState(f.actorBruno, channel.id)).toMatchObject({
      cutoff: expect.any(String),
      unreadCount: 0,
    });

    await sendMessage(f.actorAlice, channel.id, "nouveau 1");
    await sendMessage(f.actorBruno, channel.id, "nouveau 2");

    // Alice n'a pas encore lu : elle compte le message de Bruno, pas les siens.
    const state = await getUnreadState(f.actorAlice, channel.id);
    expect(state.unreadCount).toBe(1);
    expect(new Date(state.cutoff ?? "").getTime()).toBeGreaterThan(0);

    const messages = await listMessages(f.actorAlice, channel.id);
    const index = unreadSplitIndex(messages, state.cutoff);
    expect(index).toBe(3);
    expect(messages[index]?.body).toBe("nouveau 2");
    // Le séparateur tombe au même endroit que ce que compte la pastille.
    expect(unreadShown(messages, index)).toBe(state.unreadCount);
  });

  it("fait disparaître le séparateur une fois le canal lu", async () => {
    const channel = await createChannel(f.actorAlice, "lu");
    await sendMessage(f.actorAlice, channel.id, "bonjour");
    await markRead(f.actorAlice, channel.id);

    const state = await getUnreadState(f.actorAlice, channel.id);
    expect(state.unreadCount).toBe(0);
    // Le curseur est désormais postérieur au dernier message : plus de séparateur.
    const messages = await listMessages(f.actorAlice, channel.id);
    expect(unreadSplitIndex(messages, state.cutoff)).toBe(-1);
    expect(unreadShown(messages, -1)).toBe(0);
  });

  it("prend la date d'adhésion comme borne d'un canal jamais lu", async () => {
    const channel = await createChannel(f.actorAlice, "jamais-lu");
    await addChannelMember(f.actorAlice, channel.id, f.bruno);
    await sendMessage(f.actorAlice, channel.id, "un");
    await sendMessage(f.actorAlice, channel.id, "deux");
    // Aucune lecture n'a encore eu lieu : le curseur retombe naturellement sur
    // la date d'adhésion (GREATEST(last_read_at, adhésion)).
    const state = await getUnreadState(f.actorBruno, channel.id);
    expect(state.unreadCount).toBe(2);
    const messages = await listMessages(f.actorBruno, channel.id);
    expect(unreadSplitIndex(messages, state.cutoff)).toBe(0);
    expect(unreadShown(messages, 0)).toBe(2);
  });

  it("ne compte pas les messages d'autrui antérieurs à l'adhésion", async () => {
    const channel = await createChannel(f.actorAlice, " borne");
    await sendMessage(f.actorAlice, channel.id, "avant");
    await addChannelMember(f.actorAlice, channel.id, f.bruno);
    await sendMessage(f.actorAlice, channel.id, "après");

    const state = await getUnreadState(f.actorBruno, channel.id);
    expect(state.unreadCount).toBe(1);
    const messages = await listMessages(f.actorBruno, channel.id);
    expect(messages[unreadSplitIndex(messages, state.cutoff)]?.body).toBe("après");
  });

  it("refuse l'état des non-lus aux non-membres", async () => {
    const channel = await createChannel(f.actorAlice, "ferme");
    await expect(getUnreadState(f.actorBruno, channel.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(getUnreadState(f.actorChloe, channel.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(getUnreadState(f.actorAlice, "pas-un-uuid")).rejects.toMatchObject({
      code: "validation",
    });
  });

  it("place le séparateur devant le message de l’autre, après les miens", async () => {
    const channel = await createChannel(f.actorAlice, "melange");
    await addChannelMember(f.actorAlice, channel.id, f.bruno);
    await sendMessage(f.actorAlice, channel.id, "moi 1");
    await markRead(f.actorAlice, channel.id);
    await sendMessage(f.actorAlice, channel.id, "moi 2");
    await sendMessage(f.actorBruno, channel.id, "lui 1");
    const state = await getUnreadState(f.actorAlice, channel.id);
    expect(state.unreadCount).toBe(1);
    const messages = await listMessages(f.actorAlice, channel.id);
    const index = unreadSplitIndex(messages, state.cutoff);
    expect(messages[index]?.body).toBe("lui 1");
    expect(unreadShown(messages, index)).toBe(1);
  });
});

describe("chat — épingles", () => {
  it("épingle, liste et désépingle un message", async () => {
    const channel = await createChannel(f.actorAlice, "epingles");
    const first = await sendMessage(f.actorAlice, channel.id, "à garder");
    const second = await sendMessage(f.actorAlice, channel.id, "à jeter");

    await pinMessage(f.actorAlice, channel.id, first.id);
    await pinMessage(f.actorAlice, channel.id, second.id);

    const pins = await listPins(f.actorAlice, channel.id);
    expect(pins.map((pin) => pin.messageId)).toEqual([second.id, first.id]);
    expect(pins[0]).toMatchObject({
      body: "à jeter",
      authorName: "Alice",
      pinnedByName: "Alice",
      mine: true,
    });
    expect(pins[0]?.pinnedAt).not.toBe("");

    await unpinMessage(f.actorAlice, channel.id, second.id);
    expect((await listPins(f.actorAlice, channel.id)).map((pin) => pin.messageId)).toEqual([
      first.id,
    ]);
    // Désépingler deux fois ne fait rien et ne journalise rien.
    await unpinMessage(f.actorAlice, channel.id, second.id);
    const rows = await getDb().select().from(auditEvents).where(eq(auditEvents.orgId, f.orgId));
    expect(rows.filter((row) => row.action === "chat.pin.remove")).toHaveLength(1);
  });

  it("réépingler le même message ne crée qu'une épingle", async () => {
    const channel = await createChannel(f.actorAlice, "unique");
    const message = await sendMessage(f.actorAlice, channel.id, "unique");
    await pinMessage(f.actorAlice, channel.id, message.id);
    await pinMessage(f.actorAlice, channel.id, message.id);

    const pins = await listPins(f.actorAlice, channel.id);
    expect(pins).toHaveLength(1);
    const rows = await getDb().select().from(auditEvents).where(eq(auditEvents.orgId, f.orgId));
    expect(rows.filter((row) => row.action === "chat.pin.create")).toHaveLength(1);
  });

  it("laisse tout membre épingler, y compris le message d'un autre", async () => {
    const channel = await createChannel(f.actorAlice, "partage");
    await addChannelMember(f.actorAlice, channel.id, f.bruno);
    const message = await sendMessage(f.actorAlice, channel.id, "utile");

    await pinMessage(f.actorBruno, channel.id, message.id);

    const pins = await listPins(f.actorBruno, channel.id);
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({ pinnedByName: "Bruno", authorName: "Alice", mine: false });
    expect(pins[0]?.id).not.toBe(message.id);
  });

  it("refuse d'épingler un message d'un autre canal", async () => {
    const channel = await createChannel(f.actorAlice, "canal-a");
    const other = await createChannel(f.actorAlice, "canal-b");
    await addChannelMember(f.actorAlice, other.id, f.bruno);
    const message = await sendMessage(f.actorAlice, other.id, "pas le bon canal");

    await expect(pinMessage(f.actorBruno, channel.id, message.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(pinMessage(f.actorAlice, channel.id, message.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(pinMessage(f.actorAlice, channel.id, "pas-un-uuid")).rejects.toMatchObject({
      code: "validation",
    });
    await expect(unpinMessage(f.actorAlice, channel.id, "pas-un-uuid")).rejects.toMatchObject({
      code: "validation",
    });
  });

  it("réserve la lecture des épingles aux membres du canal", async () => {
    const channel = await createChannel(f.actorAlice, "epingles-privees");
    const message = await sendMessage(f.actorAlice, channel.id, "secret");
    await pinMessage(f.actorAlice, channel.id, message.id);

    await expect(listPins(f.actorBruno, channel.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(listPins(f.actorChloe, channel.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("supprime les épingles avec le canal qui les porte", async () => {
    const db = getDb();
    const channel = await createChannel(f.actorAlice, "epingles-cascade");
    const message = await sendMessage(f.actorAlice, channel.id, "ephemere");
    await pinMessage(f.actorAlice, channel.id, message.id);

    await db.delete(organization).where(eq(organization.id, f.orgId));

    expect(await db.select().from(chatPins)).toHaveLength(0);
  });

  it("expose les pièces jointes des messages épinglés", async () => {
    const channel = await createChannel(f.actorAlice, "epingles-fichiers");
    const token = await uploadChatAttachment(f.actorAlice, {
      filename: "note.txt",
      contentType: "text/plain",
      body: Buffer.from("epingle"),
    });
    const message = await sendMessage(f.actorAlice, channel.id, "avec fichier", [token]);
    await pinMessage(f.actorAlice, channel.id, message.id);

    const pins = await listPins(f.actorAlice, channel.id);
    expect(pins[0]?.attachments).toEqual([
      {
        id: expect.any(String),
        filename: "note.txt",
        contentType: "text/plain",
        sizeBytes: 7,
      },
    ]);
  });
});
