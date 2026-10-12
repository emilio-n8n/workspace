import { randomUUID } from "node:crypto";
import { closeDb, getDb, schema } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  countUnreadNotifications,
  createNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NotificationsError,
} from "../src/index.ts";

const { user, organization } = schema;

let counter = 0;
const tag = (prefix: string) => `${prefix}${++counter}_${randomUUID().slice(0, 8)}`;

type Fixtures = {
  orgId: string;
  otherOrgId: string;
  alice: string;
  bruno: string;
  actorAlice: Actor;
  actorBruno: Actor;
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

  return {
    orgId,
    otherOrgId,
    alice,
    bruno,
    actorAlice: { userId: alice, orgId },
    actorBruno: { userId: bruno, orgId },
  };
}

async function cleanup(f: Fixtures): Promise<void> {
  const db = getDb();
  // La suppression de l'organisation cascade sur les notifications.
  await db.delete(organization).where(eq(organization.id, f.orgId));
  await db.delete(organization).where(eq(organization.id, f.otherOrgId));
  await db.delete(user).where(eq(user.id, f.alice));
  await db.delete(user).where(eq(user.id, f.bruno));
}

let f: Fixtures;

beforeEach(async () => {
  f = await createFixtures();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanup(f);
});

afterAll(async () => {
  await closeDb();
});

describe("notifications — émission et lecture", () => {
  it("crée puis liste les siennes uniquement (invisibilité croisée)", async () => {
    await createNotification({
      orgId: f.orgId,
      userId: f.alice,
      kind: "share",
      title: "Nouveau partage : « Rapport »",
      href: "http://localhost:3001",
    });
    await createNotification({
      orgId: f.orgId,
      userId: f.bruno,
      kind: "task_assigned",
      title: "Tâche assignée : « Contrat »",
    });
    // Même utilisatrice, autre organisation : invisible dans l'org active.
    await createNotification({
      orgId: f.otherOrgId,
      userId: f.alice,
      kind: "system",
      title: "Hors organisation",
    });

    const aliceRows = await listNotifications(f.actorAlice);
    expect(aliceRows).toHaveLength(1);
    const [row] = aliceRows;
    expect(row).toMatchObject({
      kind: "share",
      title: "Nouveau partage : « Rapport »",
      body: null,
      href: "http://localhost:3001",
      read: false,
    });
    expect(typeof row?.createdAt).toBe("string");
    expect(Number.isNaN(new Date(row?.createdAt ?? "").getTime())).toBe(false);

    const brunoRows = await listNotifications(f.actorBruno);
    expect(brunoRows.map((entry) => entry.title)).toEqual(["Tâche assignée : « Contrat »"]);
  });

  it("compte les non lues, filtre unreadOnly et trie de la plus récente à la plus ancienne", async () => {
    await createNotification({
      orgId: f.orgId,
      userId: f.alice,
      kind: "share",
      title: "Première",
    });
    // Deux inserts distincts : horodatages strictement croissants garantis.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await createNotification({
      orgId: f.orgId,
      userId: f.alice,
      kind: "graded",
      title: "Seconde",
      body: "Note : 15/20",
    });

    expect((await listNotifications(f.actorAlice)).map((entry) => entry.title)).toEqual([
      "Seconde",
      "Première",
    ]);
    expect(await countUnreadNotifications(f.actorAlice)).toBe(2);

    const [recent] = await listNotifications(f.actorAlice, { unreadOnly: true });
    if (!recent) throw new Error("notification attendue");
    await markNotificationRead(f.actorAlice, recent.id);

    expect(await countUnreadNotifications(f.actorAlice)).toBe(1);
    expect(
      (await listNotifications(f.actorAlice, { unreadOnly: true })).map((e) => e.title),
    ).toEqual(["Première"]);
    expect(await listNotifications(f.actorAlice)).toHaveLength(2);
  });
});

describe("notifications — marquage lu", () => {
  it("markNotificationRead n'affecte que ses propres lignes (étrangère → not_found)", async () => {
    await createNotification({
      orgId: f.orgId,
      userId: f.bruno,
      kind: "graded",
      title: "Copie notée : TP",
      body: "Note : 15/20",
    });
    const [brunoRow] = await listNotifications(f.actorBruno);
    if (!brunoRow) throw new Error("notification attendue");

    const foreign = markNotificationRead(f.actorAlice, brunoRow.id);
    await expect(foreign).rejects.toBeInstanceOf(NotificationsError);
    await expect(foreign).rejects.toMatchObject({ code: "not_found" });
    expect((await listNotifications(f.actorBruno))[0]?.read).toBe(false);

    await createNotification({
      orgId: f.orgId,
      userId: f.alice,
      kind: "system",
      title: "Bienvenue",
    });
    const [ownRow] = await listNotifications(f.actorAlice);
    if (!ownRow) throw new Error("notification attendue");
    await markNotificationRead(f.actorAlice, ownRow.id);

    expect((await listNotifications(f.actorAlice))[0]?.read).toBe(true);
    expect(await countUnreadNotifications(f.actorAlice)).toBe(0);
  });

  it("markAllNotificationsRead ne marque que les siennes", async () => {
    await createNotification({
      orgId: f.orgId,
      userId: f.alice,
      kind: "share",
      title: "Une",
    });
    await createNotification({
      orgId: f.orgId,
      userId: f.alice,
      kind: "share",
      title: "Deux",
    });
    await createNotification({
      orgId: f.orgId,
      userId: f.bruno,
      kind: "task_assigned",
      title: "Trois",
    });

    await markAllNotificationsRead(f.actorAlice);

    expect(await countUnreadNotifications(f.actorAlice)).toBe(0);
    expect((await listNotifications(f.actorAlice)).every((entry) => entry.read)).toBe(true);
    expect(await countUnreadNotifications(f.actorBruno)).toBe(1);
    expect((await listNotifications(f.actorBruno))[0]?.read).toBe(false);
  });
});

describe("notifications — robustesse", () => {
  it("createNotification avale une panne d'écriture sans casser l'appelant", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    // FK violée : cette organisation n'existe pas → l'insertion échoue.
    await expect(
      createNotification({
        orgId: `org_absente_${randomUUID()}`,
        userId: f.alice,
        kind: "system",
        title: "Fantôme",
      }),
    ).resolves.toBeUndefined();

    expect(spy).toHaveBeenCalledOnce();
  });
});
