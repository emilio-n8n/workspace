import { randomUUID } from "node:crypto";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRoom,
  getRoomToken,
  joinRoom,
  leaveRoom,
  listChatMessages,
  listParticipants,
  listRaisedHands,
  lowerParticipantHand,
  MeetError,
  markChatRead,
  removeParticipant,
  sendChatMessage,
  setHandRaised,
  setParticipantMuted,
  setParticipantRole,
} from "../src/index.ts";
import { meetMembers } from "../src/schema.ts";

const { user, organization, member, auditEvents } = coreSchema;

let counter = 0;
const tag = (prefix: string) => `${prefix}${++counter}_${randomUUID().slice(0, 8)}`;

type Fixtures = {
  orgId: string;
  actorHost: Actor;
  actorGuest: Actor;
  actorOther: Actor;
  actorOutsider: Actor;
  slug: string;
};

async function createFixtures(): Promise<Fixtures> {
  const db = getDb();
  const now = new Date();

  const orgId = tag("org");
  await db
    .insert(organization)
    .values([{ id: orgId, name: tag("Org "), slug: orgId, createdAt: now }]);

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
    await db.insert(member).values({
      id: tag("mem"),
      organizationId: orgId,
      userId: id,
      role: "member",
      createdAt: now,
    });
    return id;
  };

  const host = await makeUser("Hôte");
  const guest = await makeUser("Invité");
  const other = await makeUser("Autre");
  const actorHost: Actor = { userId: host, orgId };
  const room = await createRoom(actorHost, "Réunion équipe");

  return {
    orgId,
    actorHost,
    actorGuest: { userId: guest, orgId },
    actorOther: { userId: other, orgId },
    actorOutsider: { userId: tag("usr"), orgId },
    slug: room.slug,
  };
}

async function cleanup(f: Fixtures): Promise<void> {
  const db = getDb();
  await db.delete(organization).where(eq(organization.id, f.orgId));
  for (const actor of [f.actorHost, f.actorGuest, f.actorOther, f.actorOutsider]) {
    await db.delete(user).where(eq(user.id, actor.userId));
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

describe("meet — présence et rôles", () => {
  it("enregistre l'entrée et le rôle de chacun", async () => {
    await joinRoom(f.actorHost, f.slug);
    await joinRoom(f.actorGuest, f.slug);

    const roster = await listParticipants(f.actorGuest, f.slug);
    expect(roster.count).toBe(2);
    expect(roster.canModerate).toBe(false);
    const host = roster.participants.find((p) => p.userId === f.actorHost.userId);
    expect(host?.role).toBe("host");
    expect(roster.participants.find((p) => p.userId === f.actorGuest.userId)?.role).toBe(
      "participant",
    );
  });

  it("laisse entrer sans membre sans faire planter l'effectif", async () => {
    const roster = await listParticipants(f.actorOutsider, f.slug);
    expect(roster.count).toBe(0);
    expect(roster.canModerate).toBe(false);
    expect(roster.hands).toHaveLength(0);
  });

  it("sort de la salle sans perdre son rôle en revenant", async () => {
    await joinRoom(f.actorHost, f.slug);
    await joinRoom(f.actorOther, f.slug);
    await setParticipantRole(f.actorHost, f.slug, f.actorOther.userId, "moderator");

    await leaveRoom(f.actorOther, f.slug);
    expect((await listParticipants(f.actorHost, f.slug)).count).toBe(1);

    await joinRoom(f.actorOther, f.slug);
    const back = await listParticipants(f.actorHost, f.slug);
    expect(back.count).toBe(2);
    expect(back.participants.find((p) => p.userId === f.actorOther.userId)?.role).toBe("moderator");
  });
});

describe("meet — modération", () => {
  it("réserve la modération à l'organisateur et aux animateurs", async () => {
    await joinRoom(f.actorHost, f.slug);
    await joinRoom(f.actorGuest, f.slug);
    await joinRoom(f.actorOther, f.slug);

    await expect(
      setParticipantMuted(f.actorGuest, f.slug, f.actorOther.userId, true),
    ).rejects.toThrow(MeetError);

    await setParticipantRole(f.actorHost, f.slug, f.actorGuest.userId, "moderator");
    const muted = await setParticipantMuted(f.actorGuest, f.slug, f.actorOther.userId, true);
    expect(muted.mutedByHost).toBe(true);
    expect(muted.name).toBe("Autre");
  });

  it("coupe puis rétablit le micro d'une personne", async () => {
    await joinRoom(f.actorHost, f.slug);
    await joinRoom(f.actorGuest, f.slug);

    const muted = await setParticipantMuted(f.actorHost, f.slug, f.actorGuest.userId, true);
    expect(muted.mutedByHost).toBe(true);

    const roster = await listParticipants(f.actorGuest, f.slug);
    const me = roster.participants.find((p) => p.self);
    expect(me?.mutedByHost).toBe(true);

    const restored = await setParticipantMuted(f.actorHost, f.slug, f.actorGuest.userId, false);
    expect(restored.mutedByHost).toBe(false);
  });

  it("refuse de modérer l'organisateur ou soi-même", async () => {
    await joinRoom(f.actorHost, f.slug);
    await joinRoom(f.actorGuest, f.slug);

    await expect(
      setParticipantMuted(f.actorGuest, f.slug, f.actorHost.userId, true),
    ).rejects.toThrow(MeetError);
    await expect(
      setParticipantMuted(f.actorHost, f.slug, f.actorHost.userId, true),
    ).rejects.toThrow(MeetError);
    await expect(
      setParticipantRole(f.actorHost, f.slug, f.actorHost.userId, "participant"),
    ).rejects.toThrow(MeetError);
  });

  it("réserve la nomination d'animateur au créateur", async () => {
    await joinRoom(f.actorHost, f.slug);
    await joinRoom(f.actorGuest, f.slug);
    await joinRoom(f.actorOther, f.slug);

    await expect(
      setParticipantRole(f.actorGuest, f.slug, f.actorOther.userId, "moderator"),
    ).rejects.toThrow(MeetError);

    const promoted = await setParticipantRole(
      f.actorHost,
      f.slug,
      f.actorGuest.userId,
      "moderator",
    );
    expect(promoted.role).toBe("moderator");

    const demoted = await setParticipantRole(
      f.actorHost,
      f.slug,
      f.actorGuest.userId,
      "participant",
    );
    expect(demoted.role).toBe("participant");
  });

  it("retire une personne de la réunion et la refuse à l'entrée", async () => {
    await joinRoom(f.actorHost, f.slug);
    await joinRoom(f.actorGuest, f.slug);

    const removed = await removeParticipant(f.actorHost, f.slug, f.actorGuest.userId);
    expect(removed.removed).toBe(true);

    // Elle disparaît de l'effectif.
    expect((await listParticipants(f.actorHost, f.slug)).count).toBe(1);

    // Et elle ne peut plus entrer, serveur média configuré ou non.
    await expect(getRoomToken(f.actorGuest, f.slug)).rejects.toThrow(MeetError);
    const [row] = await getDb()
      .select()
      .from(meetMembers)
      .where(eq(meetMembers.userId, f.actorGuest.userId));
    expect(row?.removedAt).not.toBeNull();
  });

  it("interdit la modération à une personne d'une autre organisation", async () => {
    await joinRoom(f.actorHost, f.slug);
    await expect(
      setParticipantMuted(f.actorOutsider, f.slug, f.actorGuest.userId, true),
    ).rejects.toThrow(MeetError);
  });
});

describe("meet — mains levées", () => {
  it("lève et baisse sa propre main", async () => {
    await joinRoom(f.actorHost, f.slug);
    await joinRoom(f.actorGuest, f.slug);

    const raised = await setHandRaised(f.actorGuest, f.slug, true);
    expect(raised.handRaised).toBe(true);
    expect(raised.handRaisedAt).not.toBeNull();

    const hands = await listRaisedHands(f.actorHost, f.slug);
    expect(hands).toHaveLength(1);
    expect(hands[0]?.userId).toBe(f.actorGuest.userId);

    const lowered = await setHandRaised(f.actorGuest, f.slug, false);
    expect(lowered.handRaised).toBe(false);
    expect(await listRaisedHands(f.actorHost, f.slug)).toHaveLength(0);
  });

  it("ordonne la file des mains levées par moment de levée", async () => {
    await joinRoom(f.actorHost, f.slug);
    await joinRoom(f.actorGuest, f.slug);
    await joinRoom(f.actorOther, f.slug);

    await setHandRaised(f.actorGuest, f.slug, true);
    await setHandRaised(f.actorOther, f.slug, true);

    const hands = await listRaisedHands(f.actorHost, f.slug);
    expect(hands.map((h) => h.userId)).toEqual([f.actorGuest.userId, f.actorOther.userId]);
  });

  it("laisse l'organisateur baisser la main de quelqu'un", async () => {
    await joinRoom(f.actorHost, f.slug);
    await joinRoom(f.actorGuest, f.slug);
    await joinRoom(f.actorOther, f.slug);
    await setHandRaised(f.actorOther, f.slug, true);

    const lowered = await lowerParticipantHand(f.actorHost, f.slug, f.actorOther.userId);
    expect(lowered.handRaised).toBe(false);
    expect(await listRaisedHands(f.actorHost, f.slug)).toHaveLength(0);
  });

  it("interdit de baisser la main d'un autre sans droit de modération", async () => {
    await joinRoom(f.actorHost, f.slug);
    await joinRoom(f.actorGuest, f.slug);
    await joinRoom(f.actorOther, f.slug);
    await setHandRaised(f.actorGuest, f.slug, true);

    await expect(lowerParticipantHand(f.actorOther, f.slug, f.actorGuest.userId)).rejects.toThrow(
      MeetError,
    );
    expect(await listRaisedHands(f.actorOther, f.slug)).toHaveLength(1);
  });

  it("baisse la main quand la personne sort de la salle", async () => {
    await joinRoom(f.actorHost, f.slug);
    await joinRoom(f.actorGuest, f.slug);
    await setHandRaised(f.actorGuest, f.slug, true);

    await leaveRoom(f.actorGuest, f.slug);
    expect(await listRaisedHands(f.actorHost, f.slug)).toHaveLength(0);
  });

  it("refuse de lever la main sans avoir rejoint", async () => {
    await expect(setHandRaised(f.actorGuest, f.slug, true)).rejects.toThrow(MeetError);
  });
});

describe("meet — chat de réunion", () => {
  it("enregistre un message et le rend visible aux autres", async () => {
    await joinRoom(f.actorHost, f.slug);
    await joinRoom(f.actorGuest, f.slug);

    const sent = await sendChatMessage(f.actorHost, f.slug, "  Bonjour à toutes et à tous  ");
    expect(sent.body).toBe("Bonjour à toutes et à tous");
    expect(sent.own).toBe(true);
    expect(sent.userName).toBe("Hôte");

    const history = await listChatMessages(f.actorGuest, f.slug);
    expect(history.messages).toHaveLength(1);
    expect(history.messages[0]?.body).toBe("Bonjour à toutes et à tous");
    expect(history.messages[0]?.own).toBe(false);
    expect(history.unread).toBe(1);
  });

  it("refuse un message vide ou trop long", async () => {
    await joinRoom(f.actorHost, f.slug);
    await expect(sendChatMessage(f.actorHost, f.slug, "   ")).rejects.toThrow(MeetError);
    await expect(sendChatMessage(f.actorHost, f.slug, "x".repeat(2001))).rejects.toThrow(MeetError);
    // Rien n'est enregistré (lecture scopée à la salle : pas de faux positif
    // venant d'une autre salle ou d'un autre fichier de tests).
    const history = await listChatMessages(f.actorHost, f.slug);
    expect(history.messages).toHaveLength(0);
  });

  it("compte les non lus sans compter ses propres messages", async () => {
    await joinRoom(f.actorHost, f.slug);
    await joinRoom(f.actorGuest, f.slug);
    await joinRoom(f.actorOther, f.slug);

    await sendChatMessage(f.actorHost, f.slug, "Premier");
    await sendChatMessage(f.actorOther, f.slug, "Deuxième");
    expect((await listChatMessages(f.actorGuest, f.slug)).unread).toBe(2);

    // Mes propres messages ne me comptent jamais comme non lus.
    await sendChatMessage(f.actorGuest, f.slug, "Réponse");
    expect((await listChatMessages(f.actorGuest, f.slug)).unread).toBe(2);
  });

  it("remet les non lus à zéro à la lecture", async () => {
    await joinRoom(f.actorHost, f.slug);
    await joinRoom(f.actorGuest, f.slug);
    await sendChatMessage(f.actorHost, f.slug, "Bonjour");

    expect((await listChatMessages(f.actorGuest, f.slug)).unread).toBe(1);
    await markChatRead(f.actorGuest, f.slug);
    expect((await listChatMessages(f.actorGuest, f.slug)).unread).toBe(0);

    // Un nouveau message repart de un.
    await sendChatMessage(f.actorHost, f.slug, "Encore");
    expect((await listChatMessages(f.actorGuest, f.slug)).unread).toBe(1);
    // L'expéditeur, lui, n'a rien de non lu.
    expect((await listChatMessages(f.actorHost, f.slug)).unread).toBe(0);
  });

  it("isole les messages par salle", async () => {
    await joinRoom(f.actorHost, f.slug);
    await sendChatMessage(f.actorHost, f.slug, "Ici");

    const other = await createRoom(f.actorHost, "Autre salle");
    await joinRoom(f.actorHost, other.slug);
    await sendChatMessage(f.actorHost, other.slug, "Là-bas");

    expect((await listChatMessages(f.actorHost, f.slug)).messages).toHaveLength(1);
    expect((await listChatMessages(f.actorHost, other.slug)).messages).toHaveLength(1);
  });

  it("refuse le chat à une personne retirée de la réunion", async () => {
    await joinRoom(f.actorHost, f.slug);
    await joinRoom(f.actorGuest, f.slug);
    await removeParticipant(f.actorHost, f.slug, f.actorGuest.userId);

    await expect(sendChatMessage(f.actorGuest, f.slug, "Coucou")).rejects.toThrow(MeetError);
  });

  it("n'audite jamais les messages (portée réunion uniquement)", async () => {
    await joinRoom(f.actorHost, f.slug);
    await joinRoom(f.actorGuest, f.slug);

    const before = await getDb().select().from(auditEvents).where(eq(auditEvents.orgId, f.orgId));
    await sendChatMessage(f.actorHost, f.slug, "Message non journalisé");
    await sendChatMessage(f.actorGuest, f.slug, "Réponse non journalisée");
    const after = await getDb().select().from(auditEvents).where(eq(auditEvents.orgId, f.orgId));

    // Aucune ligne n'est ajoutée au journal, et rien ne mentionne les messages.
    expect(after).toHaveLength(before.length);
    expect(after.every((row) => !row.action.toLowerCase().includes("message"))).toBe(true);
  });
});
