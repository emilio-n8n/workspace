import { randomUUID } from "node:crypto";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRoom,
  deleteRoom,
  getRoom,
  getRoomToken,
  listRooms,
  MeetError,
  signLiveKitToken,
} from "../src/index.ts";

const { user, organization } = coreSchema;

let counter = 0;
const tag = (prefix: string) => `${prefix}${++counter}_${randomUUID().slice(0, 8)}`;

type Fixtures = {
  orgId: string;
  otherOrgId: string;
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
    actorAlice: { userId: alice, orgId },
    actorBruno: { userId: bruno, orgId },
    actorChloe: { userId: chloe, orgId: otherOrgId },
  };
}

async function cleanup(f: Fixtures): Promise<void> {
  const db = getDb();
  await db.delete(organization).where(eq(organization.id, f.orgId));
  await db.delete(organization).where(eq(organization.id, f.otherOrgId));
  await db.delete(user).where(eq(user.id, f.actorAlice.userId));
  await db.delete(user).where(eq(user.id, f.actorBruno.userId));
  await db.delete(user).where(eq(user.id, f.actorChloe.userId));
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

describe("meet — salles", () => {
  it("crée une salle avec un slug unique et la liste dans l'organisation", async () => {
    const first = await createRoom(f.actorAlice, "Réunion hebdo");
    const second = await createRoom(f.actorAlice, "Point client");
    expect(first.slug).not.toBe(second.slug);

    const rooms = await listRooms(f.actorBruno);
    expect(rooms).toHaveLength(2);
    expect(rooms[0]?.mine).toBe(false);

    await expect(getRoom(f.actorChloe, first.slug)).rejects.toThrow(MeetError);
  });

  it("réserve la suppression au créateur", async () => {
    const room = await createRoom(f.actorAlice, "Privée");
    await expect(deleteRoom(f.actorBruno, room.slug)).rejects.toThrow(MeetError);
    await deleteRoom(f.actorAlice, room.slug);
    await expect(getRoom(f.actorAlice, room.slug)).rejects.toThrow(MeetError);
  });
});

describe("meet — jetons", () => {
  it("signale l'absence de serveur média sans configuration", async () => {
    const room = await createRoom(f.actorAlice, "Sans média");
    const token = await getRoomToken(f.actorAlice, room.slug);
    expect(token.configured).toBe(false);
  });

  it("signe un JWT HS256 conforme (3 segments, émission et salle)", () => {
    const token = signLiveKitToken({
      apiKey: "clef-test",
      apiSecret: "secret-test",
      userId: "usr_1",
      userName: "Alice",
      room: "workspace-demo",
      ttlSeconds: 60,
    });
    const parts = token.split(".");
    expect(parts).toHaveLength(3);

    const payload = JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString("utf8"));
    expect(payload.iss).toBe("clef-test");
    expect(payload.sub).toBe("usr_1");
    expect(payload.video.room).toBe("workspace-demo");
    expect(payload.exp - payload.iat).toBe(60);
  });
});
