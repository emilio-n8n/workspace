import { randomUUID } from "node:crypto";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ChatError,
  chatChannels,
  chatMembers,
  createChannel,
  listChannels,
  listMessages,
  markRead,
  sendMessage,
  startDm,
} from "../src/index.ts";

const { user, organization, member } = coreSchema;

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
    actorAlice: { userId: alice, orgId },
    actorBruno: { userId: bruno, orgId },
    actorChloe: { userId: chloe, orgId: otherOrgId },
  };
}

async function cleanup(f: Fixtures): Promise<void> {
  const db = getDb();
  await db.delete(organization).where(eq(organization.id, f.orgId));
  await db.delete(organization).where(eq(organization.id, f.otherOrgId));
  for (const id of [f.alice, f.bruno, f.actorChloe.userId]) {
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

describe("chat — canaux et discussions", () => {
  it("crée un canal et liste l'auteur comme membre", async () => {
    const channel = await createChannel(f.actorAlice, "#produit");
    const list = await listChannels(f.actorAlice);
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("produit");
    expect(list[0]?.kind).toBe("channel");

    // Bruno n'est pas membre.
    expect(await listChannels(f.actorBruno)).toHaveLength(0);
    await expect(sendMessage(f.actorBruno, channel.id, "intrusion")).rejects.toThrow(ChatError);
  });

  it("démarre une discussion directe idempotente", async () => {
    const first = await startDm(f.actorAlice, f.bruno);
    const second = await startDm(f.actorAlice, f.bruno);
    expect(second.id).toBe(first.id);

    // La clé canonique triée porte l'unicité de la discussion.
    const [row] = await getDb()
      .select({ dmKey: chatChannels.dmKey })
      .from(chatChannels)
      .where(eq(chatChannels.id, first.id));
    expect(row?.dmKey).toBe([f.alice, f.bruno].sort().join(":"));

    const aliceView = await listChannels(f.actorAlice);
    expect(aliceView[0]?.kind).toBe("dm");
    expect(aliceView[0]?.name).toBe("Bruno");

    const brunoView = await listChannels(f.actorBruno);
    expect(brunoView[0]?.name).toBe("Alice");
  });

  it("partage la même discussion en cas d'appels simultanés", async () => {
    const [first, second] = await Promise.all([
      startDm(f.actorAlice, f.bruno),
      startDm(f.actorBruno, f.alice),
    ]);
    expect(second.id).toBe(first.id);

    const rows = await getDb()
      .select({ id: chatChannels.id })
      .from(chatChannels)
      .where(eq(chatChannels.dmKey, [f.alice, f.bruno].sort().join(":")));
    expect(rows).toHaveLength(1);
  });

  it("retrouve et rattrape une discussion héritée sans dm_key", async () => {
    const db = getDb();
    const [legacy] = await db
      .insert(chatChannels)
      .values({ orgId: f.orgId, kind: "dm", name: null, createdBy: f.alice })
      .returning({ id: chatChannels.id });
    if (!legacy) throw new Error("Insertion de la discussion héritée impossible.");
    await db.insert(chatMembers).values([
      { channelId: legacy.id, userId: f.alice },
      { channelId: legacy.id, userId: f.bruno },
    ]);

    const dm = await startDm(f.actorAlice, f.bruno);
    expect(dm.id).toBe(legacy.id);

    const [row] = await db
      .select({ dmKey: chatChannels.dmKey })
      .from(chatChannels)
      .where(eq(chatChannels.id, legacy.id));
    expect(row?.dmKey).toBe([f.alice, f.bruno].sort().join(":"));
  });

  it("refuse une discussion avec un membre hors organisation", async () => {
    await expect(startDm(f.actorAlice, f.actorChloe.userId)).rejects.toThrow(ChatError);
  });
});

describe("chat — messages", () => {
  it("envoie et liste les messages dans l'ordre", async () => {
    const channel = await createChannel(f.actorAlice, "général");
    await sendMessage(f.actorAlice, channel.id, "Bonjour");
    await sendMessage(f.actorAlice, channel.id, "Tout le monde ?");

    const messages = await listMessages(f.actorAlice, channel.id);
    expect(messages.map((message) => message.body)).toEqual(["Bonjour", "Tout le monde ?"]);
    expect(messages[0]?.mine).toBe(true);
  });

  it("compte les non-lus et les remet à zéro à la lecture", async () => {
    const dm = await startDm(f.actorAlice, f.bruno);
    await sendMessage(f.actorAlice, dm.id, "Salut Bruno");
    await sendMessage(f.actorAlice, dm.id, "Tu as vu le doc ?");

    const brunoChannels = await listChannels(f.actorBruno);
    expect(brunoChannels[0]?.unreadCount).toBe(2);

    await markRead(f.actorBruno, dm.id);
    const afterRead = await listChannels(f.actorBruno);
    expect(afterRead[0]?.unreadCount).toBe(0);
  });

  it("ne compte pas ses propres messages et ignore l'historique antérieur à l'adhésion", async () => {
    const db = getDb();
    const channel = await createChannel(f.actorAlice, "historique");
    await sendMessage(f.actorAlice, channel.id, "avant Bruno 1");
    await sendMessage(f.actorAlice, channel.id, "avant Bruno 2");

    // Bruno rejoint après ces messages : rien en non-lu (created_at de l'adhésion).
    await db.insert(chatMembers).values({ channelId: channel.id, userId: f.bruno });
    const before = (await listChannels(f.actorBruno)).find((view) => view.id === channel.id);
    expect(before?.unreadCount).toBe(0);

    await sendMessage(f.actorAlice, channel.id, "après Bruno");
    const after = (await listChannels(f.actorBruno)).find((view) => view.id === channel.id);
    expect(after?.unreadCount).toBe(1);

    // L'autrice ne compte jamais ses propres messages.
    const alice = (await listChannels(f.actorAlice)).find((view) => view.id === channel.id);
    expect(alice?.unreadCount).toBe(0);
  });

  it("ne fait jamais reculer le curseur de lecture", async () => {
    const db = getDb();
    const channel = await createChannel(f.actorAlice, "curseur");
    const future = new Date(Date.now() + 60_000);
    await db
      .update(chatMembers)
      .set({ lastReadAt: future })
      .where(and(eq(chatMembers.channelId, channel.id), eq(chatMembers.userId, f.alice)));

    await markRead(f.actorAlice, channel.id);

    const [row] = await db
      .select({ lastReadAt: chatMembers.lastReadAt })
      .from(chatMembers)
      .where(and(eq(chatMembers.channelId, channel.id), eq(chatMembers.userId, f.alice)));
    expect(row?.lastReadAt?.getTime()).toBe(future.getTime());
  });

  it("agrège les non-lus de plusieurs canaux et discussions", async () => {
    const db = getDb();
    const alpha = await createChannel(f.actorAlice, "alpha");
    const beta = await createChannel(f.actorAlice, "beta");
    await db.insert(chatMembers).values([
      { channelId: alpha.id, userId: f.bruno },
      { channelId: beta.id, userId: f.bruno },
    ]);

    await sendMessage(f.actorAlice, alpha.id, "a1");
    await sendMessage(f.actorAlice, alpha.id, "a2");
    await sendMessage(f.actorAlice, beta.id, "b1");

    const dm = await startDm(f.actorAlice, f.bruno);
    await sendMessage(f.actorAlice, dm.id, "coucou");

    const beforeReply = new Map((await listChannels(f.actorBruno)).map((view) => [view.id, view]));
    expect(beforeReply.get(dm.id)?.unreadCount).toBe(1);

    await sendMessage(f.actorBruno, dm.id, "réponse");

    const views = await listChannels(f.actorBruno);
    const byId = new Map(views.map((view) => [view.id, view]));
    expect(byId.get(alpha.id)?.unreadCount).toBe(2);
    expect(byId.get(beta.id)?.unreadCount).toBe(1);
    // La réponse de Bruno avance aussi son curseur : plus rien de non lu,
    // et son propre message ne se compte jamais.
    expect(byId.get(dm.id)?.unreadCount).toBe(0);
    expect(byId.get(dm.id)?.kind).toBe("dm");
    expect(byId.get(dm.id)?.name).toBe("Alice");
    expect(byId.get(alpha.id)?.lastMessageAt).not.toBeNull();
    expect(byId.get(beta.id)?.lastMessageAt).not.toBeNull();
  });

  it("borne la limite de pagination", async () => {
    const channel = await createChannel(f.actorAlice, "limites");
    for (let index = 1; index <= 3; index += 1) {
      await sendMessage(f.actorAlice, channel.id, `message ${index}`);
    }

    const clampedLow = await listMessages(f.actorAlice, channel.id, { limit: -1 });
    expect(clampedLow).toHaveLength(1);
    expect(clampedLow[0]?.body).toBe("message 3");

    const clampedHigh = await listMessages(f.actorAlice, channel.id, { limit: 500 });
    expect(clampedHigh).toHaveLength(3);
  });

  it("rejette les curseurs invalides", async () => {
    const channel = await createChannel(f.actorAlice, "curseurs");
    await expect(
      listMessages(f.actorAlice, channel.id, { before: "pas-une-date" }),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(
      listMessages(f.actorAlice, channel.id, { beforeId: "pas-un-uuid" }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("pagine avec beforeId sur la clé (created_at, id)", async () => {
    const channel = await createChannel(f.actorAlice, "pagination");
    for (let index = 1; index <= 5; index += 1) {
      await sendMessage(f.actorAlice, channel.id, `message ${index}`);
    }

    const firstPage = await listMessages(f.actorAlice, channel.id, { limit: 2 });
    expect(firstPage.map((message) => message.body)).toEqual(["message 4", "message 5"]);

    const cursor = firstPage[0];
    if (!cursor) throw new Error("Curseur de pagination manquant.");
    const secondPage = await listMessages(f.actorAlice, channel.id, {
      before: cursor.createdAt,
      beforeId: cursor.id,
      limit: 2,
    });
    expect(secondPage.map((message) => message.body)).toEqual(["message 2", "message 3"]);
  });

  it("valide le corps du message", async () => {
    const channel = await createChannel(f.actorAlice, "strict");
    await expect(sendMessage(f.actorAlice, channel.id, "   ")).rejects.toThrow(ChatError);
    await expect(sendMessage(f.actorAlice, channel.id, "x".repeat(4001))).rejects.toThrow(
      ChatError,
    );
  });

  it("ne franchit jamais l'organisation", async () => {
    const channel = await createChannel(f.actorAlice, "privé");
    await expect(listMessages(f.actorChloe, channel.id)).rejects.toThrow(ChatError);
    await expect(markRead(f.actorChloe, channel.id)).rejects.toThrow(ChatError);
  });
});
