import { randomUUID } from "node:crypto";
import { closeDb, getDb, schema } from "@workspace/database";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordAudit, withAudit } from "../src/index.ts";

const { user, organization, auditEvents } = schema;

let counter = 0;
const tag = (prefix: string) => `${prefix}${++counter}_${randomUUID().slice(0, 8)}`;

/** Même forme d'erreur que PolicyError (détection par `name`). */
class PolicyError extends Error {
  constructor(message = "Accès refusé : permission insuffisante.") {
    super(message);
    this.name = "PolicyError";
  }
}

type Fixtures = { orgId: string; userId: string };

async function createFixtures(): Promise<Fixtures> {
  const db = getDb();
  const now = new Date();

  const orgId = tag("org");
  await db
    .insert(organization)
    .values({ id: orgId, name: tag("Org "), slug: orgId, createdAt: now });

  const userId = tag("usr");
  await db.insert(user).values({
    id: userId,
    name: "Acteur",
    email: `${userId}@example.org`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });

  return { orgId, userId };
}

async function cleanup(f: Fixtures): Promise<void> {
  const db = getDb();
  await db.delete(auditEvents).where(eq(auditEvents.orgId, f.orgId));
  await db.delete(user).where(eq(user.id, f.userId));
  await db.delete(organization).where(eq(organization.id, f.orgId));
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

describe("audit — recordAudit", () => {
  it("insère l'événement avec tous ses champs", async () => {
    await recordAudit({
      orgId: f.orgId,
      actorUserId: f.userId,
      action: "admin.member.add",
      resourceType: "member",
      resourceId: "usr_cible",
      result: "success",
      metadata: { email: "cible@example.org", role: "member", admin: true, note: null },
    });

    const db = getDb();
    const rows = await db.select().from(auditEvents).where(eq(auditEvents.orgId, f.orgId));
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.action).toBe("admin.member.add");
    expect(row?.actorUserId).toBe(f.userId);
    expect(row?.actorTokenId).toBeNull();
    expect(row?.resourceType).toBe("member");
    expect(row?.resourceId).toBe("usr_cible");
    expect(row?.result).toBe("success");
    expect(row?.metadata).toEqual({
      email: "cible@example.org",
      role: "member",
      admin: true,
      note: null,
    });
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  it("avale une panne d'audit sans casser l'appelant", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    // FK violée : cette organisation n'existe pas → l'insertion échoue.
    await expect(
      recordAudit({
        orgId: `org_absente_${randomUUID()}`,
        action: "admin.quota.update",
        result: "success",
      }),
    ).resolves.toBeUndefined();

    expect(spy).toHaveBeenCalledOnce();
  });
});

describe("audit — withAudit", () => {
  it("journalise success et retourne la valeur", async () => {
    const value = await withAudit(
      { orgId: f.orgId, actorUserId: f.userId, action: "auth.token.create" },
      async () => "jeton-créé",
    );
    expect(value).toBe("jeton-créé");

    const db = getDb();
    const [row] = await db.select().from(auditEvents).where(eq(auditEvents.orgId, f.orgId));
    expect(row?.action).toBe("auth.token.create");
    expect(row?.result).toBe("success");
  });

  it("journalise denied pour un refus et relance l'erreur", async () => {
    const denied = new PolicyError();

    await expect(
      withAudit(
        { orgId: f.orgId, actorUserId: f.userId, action: "admin.member.remove" },
        async () => {
          throw denied;
        },
      ),
    ).rejects.toBe(denied);

    const db = getDb();
    const [row] = await db.select().from(auditEvents).where(eq(auditEvents.orgId, f.orgId));
    expect(row?.action).toBe("admin.member.remove");
    expect(row?.result).toBe("denied");
  });
});
