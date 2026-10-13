import { randomUUID } from "node:crypto";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  admitParticipant,
  createRoom,
  denyParticipant,
  getLobbyStatus,
  getRoom,
  getRoomToken,
  listLobby,
  listRooms,
  MeetError,
  requestAdmission,
  setRoomAdmission,
  withdrawAdmission,
} from "../src/index.ts";
import { meetLobby, meetRooms } from "../src/schema.ts";

const { user, organization, auditEvents, member } = coreSchema;

let counter = 0;
const tag = (prefix: string) => `${prefix}${++counter}_${randomUUID().slice(0, 8)}`;

type Fixtures = {
  orgId: string;
  actorHost: Actor;
  actorGuest: Actor;
  actorOther: Actor;
  actorOutsider: Actor;
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
    // Appartenance à l'organisation (exigée pour apparaître dans la salle d'attente).
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
  return {
    orgId,
    actorHost: { userId: host, orgId },
    actorGuest: { userId: guest, orgId },
    actorOther: { userId: other, orgId },
    actorOutsider: { userId: tag("usr"), orgId },
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

describe("meet — salle d'attente", () => {
  it("laisse entrer l'organisateur et met les autres en attente", async () => {
    const room = await createRoom(f.actorHost, "Point hebdo");
    const host = await getLobbyStatus(f.actorHost, room.slug);
    expect(host).toMatchObject({ required: true, host: true, state: "admitted" });

    const guest = await getLobbyStatus(f.actorGuest, room.slug);
    expect(guest).toMatchObject({ required: true, host: false, state: "none" });
    expect(guest.waiting).toBe(0);
  });

  it("enregistre une demande et la fait apparaître chez l'organisateur", async () => {
    const room = await createRoom(f.actorHost, "Comité");
    await requestAdmission(f.actorGuest, room.slug);

    const guest = await getLobbyStatus(f.actorGuest, room.slug);
    expect(guest.state).toBe("waiting");
    expect(guest.waiting).toBe(1);

    const entries = await listLobby(f.actorHost, room.slug);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.userName).toBe("Invité");
    expect(entries[0]?.userId).toBe(f.actorGuest.userId);
  });

  it("réinitialise une demande refusée sans jamais écraser une admission", async () => {
    const room = await createRoom(f.actorHost, "Revue");
    await requestAdmission(f.actorGuest, room.slug);
    await denyParticipant(f.actorHost, room.slug, f.actorGuest.userId);
    expect((await getLobbyStatus(f.actorGuest, room.slug)).state).toBe("denied");

    // Nouvelle demande après refus : la personne revient en attente.
    await requestAdmission(f.actorGuest, room.slug);
    expect((await getLobbyStatus(f.actorGuest, room.slug)).state).toBe("waiting");

    // Une demande ultérieure ne fait pas revenir quelqu'un d'admis en attente.
    await admitParticipant(f.actorHost, room.slug, f.actorGuest.userId);
    await requestAdmission(f.actorGuest, room.slug);
    expect((await getLobbyStatus(f.actorGuest, room.slug)).state).toBe("admitted");
    expect(await listLobby(f.actorHost, room.slug)).toHaveLength(0);
  });

  it("réserve l'admission et le refus à l'organisateur", async () => {
    const room = await createRoom(f.actorHost, "Privée");
    await requestAdmission(f.actorGuest, room.slug);

    await expect(admitParticipant(f.actorGuest, room.slug, f.actorGuest.userId)).rejects.toThrow(
      MeetError,
    );
    await expect(denyParticipant(f.actorGuest, room.slug, f.actorGuest.userId)).rejects.toThrow(
      MeetError,
    );

    const admitted = await admitParticipant(f.actorHost, room.slug, f.actorGuest.userId);
    expect(admitted.userId).toBe(f.actorGuest.userId);
    expect((await getLobbyStatus(f.actorGuest, room.slug)).state).toBe("admitted");
  });

  it("refuse d'admettre quelqu'un qui n'est pas dans l'organisation", async () => {
    const created = await createRoom(f.actorHost, "Fermée");
    const room = await getRoom(f.actorHost, created.slug);
    await expect(admitParticipant(f.actorHost, room.slug, f.actorOutsider.userId)).rejects.toThrow(
      MeetError,
    );

    const [row] = await getDb().select().from(meetRooms).where(eq(meetRooms.slug, room.slug));
    const rows = await getDb()
      .select()
      .from(meetLobby)
      .where(
        and(eq(meetLobby.roomId, row?.id ?? ""), eq(meetLobby.userId, f.actorOutsider.userId)),
      );
    expect(rows).toHaveLength(0);
  });

  it("interdit la lecture de la file à un simple invité", async () => {
    const room = await createRoom(f.actorHost, "Secrète");
    await requestAdmission(f.actorGuest, room.slug);
    await expect(listLobby(f.actorGuest, room.slug)).rejects.toThrow(MeetError);
  });

  it("annule une demande sur retrait volontaire", async () => {
    const room = await createRoom(f.actorHost, "Annulable");
    await requestAdmission(f.actorGuest, room.slug);
    await withdrawAdmission(f.actorGuest, room.slug);
    expect((await getLobbyStatus(f.actorGuest, room.slug)).state).toBe("none");
    expect(await listLobby(f.actorHost, room.slug)).toHaveLength(0);
  });

  it("désactive la salle d'attente par l'organisateur (entrée libre)", async () => {
    const room = await createRoom(f.actorHost, "Ouvert");
    await requestAdmission(f.actorGuest, room.slug);
    expect((await getLobbyStatus(f.actorGuest, room.slug)).state).toBe("waiting");

    const updated = await setRoomAdmission(f.actorHost, room.slug, false);
    expect(updated.requireAdmission).toBe(false);
    // Les personnes déjà en attente entrent immédiatement.
    expect((await getLobbyStatus(f.actorGuest, room.slug)).state).toBe("admitted");
    expect(await listLobby(f.actorHost, room.slug)).toHaveLength(0);
    expect((await listRooms(f.actorHost))[0]?.requireAdmission).toBe(false);

    // La sortie reste réservée à l'organisateur.
    await expect(setRoomAdmission(f.actorGuest, room.slug, true)).rejects.toThrow(MeetError);
  });

  it("laisse passer l'organisateur dans les deux sens", async () => {
    const room = await createRoom(f.actorHost, "Deux sens");
    await setRoomAdmission(f.actorHost, room.slug, false);
    expect((await getLobbyStatus(f.actorGuest, room.slug)).state).toBe("admitted");
    expect((await getLobbyStatus(f.actorHost, room.slug)).state).toBe("admitted");
    expect((await getRoom(f.actorHost, room.slug)).requireAdmission).toBe(false);
  });
});

describe("meet — jetons et salle d'attente", () => {
  it("refuse le jeton tant que l'entrée n'est pas admise", async () => {
    const room = await createRoom(f.actorHost, "Gardée");
    await requestAdmission(f.actorGuest, room.slug);
    // Sans serveur média configuré, le jeton n'est de toute façon pas émis.
    expect((await getRoomToken(f.actorGuest, room.slug)).configured).toBe(false);

    await admitParticipant(f.actorHost, room.slug, f.actorGuest.userId);
    expect((await getLobbyStatus(f.actorGuest, room.slug)).state).toBe("admitted");
    expect((await getRoomToken(f.actorGuest, room.slug)).configured).toBe(false);
  });
});

describe("meet — audit de la salle d'attente", () => {
  it("journalise demande, admission et refus", async () => {
    const room = await createRoom(f.actorHost, "Journalisée");

    await requestAdmission(f.actorGuest, room.slug);
    await requestAdmission(f.actorOther, room.slug);
    await admitParticipant(f.actorHost, room.slug, f.actorGuest.userId);
    await denyParticipant(f.actorHost, room.slug, f.actorOther.userId);

    const rows = await getDb().select().from(auditEvents).where(eq(auditEvents.orgId, f.orgId));

    const actions = rows.map((row) => row.action);
    expect(actions).toContain("meet.room.create");
    expect(actions).toContain("meet.lobby.request");
    expect(actions).toContain("meet.lobby.admit");
    expect(actions).toContain("meet.lobby.deny");

    const admission = rows.find((row) => row.action === "meet.lobby.admit");
    expect(admission).toMatchObject({
      resourceType: "room",
      resourceId: room.slug,
      result: "success",
    });
    expect(admission?.metadata).toMatchObject({ targetUserId: f.actorGuest.userId });

    const refusal = rows.find((row) => row.action === "meet.lobby.deny");
    expect(refusal?.metadata).toMatchObject({ targetUserId: f.actorOther.userId });
  });
});
