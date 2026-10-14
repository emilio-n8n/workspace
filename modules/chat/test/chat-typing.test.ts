import { randomUUID } from "node:crypto";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { addChannelMember, createChannel, listTypingUsers, notifyTyping } from "../src/index.ts";
import {
  activeTypingSignals,
  formatTypingStatus,
  isThrottled,
  pruneTypingUsers,
  publishTyping,
  stopTyping,
  type TypingSignal,
} from "../src/typing.ts";

const { user, organization, member } = coreSchema;

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

  await db.insert(member).values([
    { id: tag("mem"), organizationId: orgId, userId: alice, role: "owner", createdAt: now },
    { id: tag("mem"), organizationId: orgId, userId: bruno, role: "member", createdAt: now },
    { id: tag("mem"), organizationId: otherOrgId, userId: chloe, role: "owner", createdAt: now },
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

/** Signal de frappe isolé (identifiants uniques par test). */
function signal(channelId: string, userId: string, name: string, at: number): TypingSignal {
  return { channelId, userId, name, at };
}

describe("indicateur de frappe — libellé", () => {
  it("reste muet sans personne", () => {
    expect(formatTypingStatus([])).toBe("");
  });

  it("nomme une seule personne", () => {
    expect(formatTypingStatus(["Alice"])).toBe("Alice est en train d'écrire…");
  });

  it("nomme deux personnes", () => {
    expect(formatTypingStatus(["Alice", "Bruno"])).toBe("Alice et Bruno sont en train d'écrire…");
  });

  it("énumère trois personnes", () => {
    expect(formatTypingStatus(["Alice", "Bruno", "Chloé"])).toBe(
      "Alice, Bruno et Chloé sont en train d'écrire…",
    );
  });

  it("compte au-delà de trois", () => {
    expect(formatTypingStatus(["A", "B", "C", "D", "E"])).toBe("5 personnes écrivent…");
  });

  it("ignore les doublons et les noms vides", () => {
    expect(formatTypingStatus(["Alice", "Alice", "  "])).toBe("Alice est en train d'écrire…");
  });
});

describe("indicateur de frappe — expiration", () => {
  it("garde les signaux récents et écarte les périmés", () => {
    const now = 1_000_000;
    const users = [
      { userId: "u1", name: "Alice", at: now - 1000 },
      { userId: "u2", name: "Bruno", at: now - 60_000 },
    ];
    expect(pruneTypingUsers(users, now)).toEqual([users[0]]);
  });

  it("conserve un signal exactement à la limite du TTL", () => {
    const now = 500_000;
    expect(pruneTypingUsers([{ userId: "u1", name: "Alice", at: now - 4999 }], now)).toHaveLength(
      1,
    );
    expect(pruneTypingUsers([{ userId: "u1", name: "Alice", at: now - 5001 }], now)).toHaveLength(
      0,
    );
  });

  it("ne renvoie rien quand tout est périmé", () => {
    expect(pruneTypingUsers([], 1)).toEqual([]);
  });
});

describe("indicateur de frappe — bus par canal", () => {
  const channel = tag("chan");

  afterEach(() => {
    stopTyping(channel, "u1");
    stopTyping(channel, "u2");
  });

  it("retient les signaux valides et les classe du plus récent au plus ancien", () => {
    const now = 2_000_000;
    publishTyping(signal(channel, "u1", "Alice", now - 4000));
    publishTyping(signal(channel, "u2", "Bruno", now));

    const actives = activeTypingSignals(channel, now);
    expect(actives.map((row) => row.userId)).toEqual(["u2", "u1"]);
  });

  it("écarte les signaux périmés et libère le canal", () => {
    const now = 3_000_000;
    publishTyping(signal(channel, "u1", "Alice", now - 60_000));
    expect(activeTypingSignals(channel, now)).toEqual([]);
  });

  it("écrase le signal d'une même personne (le plus récent gagne)", () => {
    const now = 4_000_000;
    publishTyping(signal(channel, "u1", "Alice", now));
    publishTyping(signal(channel, "u1", "Alice", now + 1000));
    const actives = activeTypingSignals(channel, now + 1000);
    expect(actives).toHaveLength(1);
    expect(actives[0]?.at).toBe(now + 1000);
  });

  it("refuse un signal trop rapproché du précédent (anti-flot)", () => {
    const now = 5_000_000;
    expect(isThrottled(channel, "u1", now)).toBe(false);
    expect(publishTyping(signal(channel, "u1", "Alice", now))).toBe(true);
    expect(publishTyping(signal(channel, "u1", "Alice", now + 200))).toBe(false);
    expect(publishTyping(signal(channel, "u1", "Alice", now + 1500))).toBe(true);
  });

  it("isole les canaux entre eux", () => {
    const other = tag("chan");
    const now = 6_000_000;
    publishTyping(signal(channel, "u1", "Alice", now));
    publishTyping(signal(other, "u2", "Bruno", now));
    expect(activeTypingSignals(channel, now).map((row) => row.userId)).toEqual(["u1"]);
    expect(activeTypingSignals(other, now).map((row) => row.userId)).toEqual(["u2"]);
    stopTyping(other, "u2");
  });

  it("retire un signal sur arrêt explicite", () => {
    const now = 7_000_000;
    publishTyping(signal(channel, "u1", "Alice", now));
    expect(activeTypingSignals(channel, now)).toHaveLength(1);
    stopTyping(channel, "u1");
    expect(activeTypingSignals(channel, now)).toHaveLength(0);
  });
});

describe("indicateur de frappe — service", () => {
  it("diffuse un signal aux autres membres du canal", async () => {
    const channel = await createChannel(f.actorAlice, "frappe");
    await addChannelMember(f.actorAlice, channel.id, f.bruno);
    await notifyTyping(f.actorAlice, channel.id);

    const viewers = await listTypingUsers(f.actorBruno, channel.id);
    expect(viewers).toHaveLength(1);
    expect(viewers[0]).toMatchObject({ userId: f.alice, name: "Alice" });
    expect(viewers[0]?.at).toBeGreaterThan(0);
  });

  it("n'annonce jamais l'acteur à lui-même", async () => {
    const channel = await createChannel(f.actorAlice, "frappe-moi");
    await notifyTyping(f.actorAlice, channel.id);

    expect(await listTypingUsers(f.actorAlice, channel.id)).toEqual([]);
  });

  it("classe les personnes par nom", async () => {
    const channel = await createChannel(f.actorAlice, "frappe-ordre");
    await addChannelMember(f.actorAlice, channel.id, f.bruno);
    await notifyTyping(f.actorAlice, channel.id);
    await notifyTyping(f.actorBruno, channel.id);

    const viewers = await listTypingUsers(f.actorChloe, channel.id).catch(() => []);
    expect(viewers).toEqual([]);
  });

  it("coupe le signal à l'envoi du message", async () => {
    const channel = await createChannel(f.actorAlice, "frappe-arret");
    await notifyTyping(f.actorAlice, channel.id);
    await notifyTyping(f.actorAlice, channel.id, false);

    expect(activeTypingSignals(channel.id)).toEqual([]);
  });

  it("exige l'appartenance, jamais le franchissement d'organisation", async () => {
    const channel = await createChannel(f.actorAlice, "frappe-prive");
    await expect(notifyTyping(f.actorChloe, channel.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(listTypingUsers(f.actorChloe, channel.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(notifyTyping(f.actorAlice, "pas-un-uuid")).rejects.toMatchObject({
      code: "validation",
    });
  });
});
