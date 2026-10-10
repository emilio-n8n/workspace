import { randomUUID } from "node:crypto";
import { closeDb, getDb, schema } from "@workspace/database";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertCan } from "../src/assert";
import {
  accessibleResourceIds,
  createGrant,
  listGrants,
  resolveRole,
  revokeGrant,
} from "../src/grants";
import { can } from "../src/policy";
import type { Action, Actor, Resource } from "../src/types";

const { user, organization, team, teamMember, resourceGrants } = schema;

let counter = 0;
function tag(prefix: string): string {
  counter += 1;
  return `${prefix}${counter}_${randomUUID().slice(0, 8)}`;
}

function actorOf(userId: string, orgId: string): Actor {
  return { userId, orgId };
}

type Fixtures = {
  orgId: string;
  alice: string;
  bruno: string;
  chloe: string;
  groupId: string;
  resource: Resource;
};

async function createFixtures(): Promise<Fixtures> {
  const db = getDb();
  const now = new Date();

  const orgId = tag("org");
  await db
    .insert(organization)
    .values({ id: orgId, name: tag("Org "), slug: orgId, createdAt: now });

  const createUser = async (name: string): Promise<string> => {
    const id = tag("usr");
    await db.insert(user).values({
      id,
      name,
      email: `${name.toLowerCase()}.${id}@example.org`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  };

  const alice = await createUser("Alice");
  const bruno = await createUser("Bruno");
  const chloe = await createUser("Chloe");

  // Alice est dans le groupe ; Bruno et Chloé non.
  const groupId = tag("team");
  await db
    .insert(team)
    .values({ id: groupId, name: "Equipe", organizationId: orgId, createdAt: now });
  await db.insert(teamMember).values({ id: tag("mem"), teamId: groupId, userId: alice });

  return {
    orgId,
    alice,
    bruno,
    chloe,
    groupId,
    resource: { type: "file", id: randomUUID(), orgId },
  };
}

async function cleanup(f: Fixtures): Promise<void> {
  const db = getDb();
  await db.delete(resourceGrants).where(eq(resourceGrants.orgId, f.orgId));
  await db.delete(teamMember).where(eq(teamMember.teamId, f.groupId));
  await db.delete(team).where(eq(team.id, f.groupId));
  for (const id of [f.alice, f.bruno, f.chloe]) await db.delete(user).where(eq(user.id, id));
  await db.delete(organization).where(eq(organization.id, f.orgId));
}

/** Vérifie `can` sur la ressource du jeu de test courant. */
function canOn(actor: Actor, action: Action): Promise<boolean> {
  return can(actor, action, fixtures.resource);
}

let fixtures: Fixtures;

beforeEach(async () => {
  fixtures = await createFixtures();
});

afterEach(async () => {
  await cleanup(fixtures);
});

afterAll(async () => {
  await closeDb();
});

describe("permissions — refus par défaut (ADR-0004)", () => {
  it("aucun grant ⇒ aucun droit", async () => {
    const actor = actorOf(fixtures.alice, fixtures.orgId);
    expect(await resolveRole(actor, fixtures.resource)).toBeNull();
    expect(await canOn(actor, "read")).toBe(false);
    expect(await canOn(actor, "write")).toBe(false);
  });

  it("une autre organisation est toujours refusée, même avec un grant correspondant", async () => {
    const actor = actorOf(fixtures.alice, fixtures.orgId);
    await createGrant({
      resource: fixtures.resource,
      subject: { kind: "user", id: actor.userId },
      role: "owner",
      actor,
    });

    const outsider = actorOf(actor.userId, tag("org"));
    expect(await can(outsider, "read", fixtures.resource)).toBe(false);
  });
});

describe("permissions — grants directs", () => {
  it("viewer lit mais n'écrit pas", async () => {
    const actor = actorOf(fixtures.bruno, fixtures.orgId);
    await createGrant({
      resource: fixtures.resource,
      subject: { kind: "user", id: actor.userId },
      role: "viewer",
      actor,
    });

    expect(await canOn(actor, "read")).toBe(true);
    expect(await canOn(actor, "comment")).toBe(false);
    expect(await canOn(actor, "write")).toBe(false);
    expect(await canOn(actor, "share")).toBe(false);
  });

  it("editor écrit ; owner partage et supprime", async () => {
    const editor = actorOf(fixtures.bruno, fixtures.orgId);
    await createGrant({
      resource: fixtures.resource,
      subject: { kind: "user", id: editor.userId },
      role: "editor",
      actor: editor,
    });
    expect(await canOn(editor, "write")).toBe(true);
    expect(await canOn(editor, "share")).toBe(false);

    const owner = actorOf(fixtures.chloe, fixtures.orgId);
    await createGrant({
      resource: fixtures.resource,
      subject: { kind: "user", id: owner.userId },
      role: "owner",
      actor: owner,
    });
    expect(await canOn(owner, "share")).toBe(true);
    expect(await canOn(owner, "delete")).toBe(true);
  });

  it("un grant expiré ne donne plus aucun droit ; un grant encore valide oui", async () => {
    const actor = actorOf(fixtures.bruno, fixtures.orgId);
    await createGrant({
      resource: fixtures.resource,
      subject: { kind: "user", id: actor.userId },
      role: "editor",
      actor,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await canOn(actor, "write")).toBe(true);

    for (const grant of await listGrants(fixtures.resource)) await revokeGrant(grant.id);

    await createGrant({
      resource: fixtures.resource,
      subject: { kind: "user", id: actor.userId },
      role: "editor",
      actor,
      expiresAt: new Date(Date.now() - 60_000),
    });
    expect(await canOn(actor, "write")).toBe(false);
  });

  it("révocation effective immédiatement", async () => {
    const actor = actorOf(fixtures.bruno, fixtures.orgId);
    const grant = await createGrant({
      resource: fixtures.resource,
      subject: { kind: "user", id: actor.userId },
      role: "editor",
      actor,
    });
    expect(grant).not.toBeNull();
    expect(await revokeGrant(grant!.id)).toBe(true);
    expect(await revokeGrant(grant!.id)).toBe(false);
    expect(await canOn(actor, "read")).toBe(false);
  });

  it("doublon de grant : aucune erreur, une seule ligne", async () => {
    const actor = actorOf(fixtures.bruno, fixtures.orgId);
    const input = {
      resource: fixtures.resource,
      subject: { kind: "user" as const, id: actor.userId },
      role: "viewer" as const,
      actor,
    };
    expect(await createGrant(input)).not.toBeNull();
    expect(await createGrant(input)).toBeNull();
    expect(await listGrants(fixtures.resource)).toHaveLength(1);
  });
});

describe("permissions — grants par groupe et par organisation", () => {
  it("membre du groupe accède, non-membre non", async () => {
    const actor = actorOf(fixtures.alice, fixtures.orgId);
    await createGrant({
      resource: fixtures.resource,
      subject: { kind: "group", id: fixtures.groupId },
      role: "editor",
      actor,
    });

    expect(await canOn(actor, "write")).toBe(true);
    expect(await canOn(actorOf(fixtures.chloe, fixtures.orgId), "read")).toBe(false);
  });

  it("grant à l'organisation : tout membre y accède", async () => {
    const actor = actorOf(fixtures.chloe, fixtures.orgId);
    await createGrant({
      resource: fixtures.resource,
      subject: { kind: "org", id: fixtures.orgId },
      role: "viewer",
      actor,
    });

    expect(await canOn(actorOf(fixtures.bruno, fixtures.orgId), "read")).toBe(true);
    expect(await canOn(actor, "read")).toBe(true);
  });
});

describe("permissions — listes filtrées", () => {
  it("accessibleResourceIds ne retourne que ce qui est autorisé", async () => {
    const actor = actorOf(fixtures.bruno, fixtures.orgId);
    const otherResourceId = randomUUID();
    await createGrant({
      resource: fixtures.resource,
      subject: { kind: "user", id: actor.userId },
      role: "viewer",
      actor,
    });

    const ids = await accessibleResourceIds(actor, "read", "file", [
      fixtures.resource.id,
      otherResourceId,
    ]);
    expect([...ids]).toEqual([fixtures.resource.id]);
  });
});

describe("permissions — assertCan", () => {
  it("lève PolicyError forbidden sans permission", async () => {
    const actor = actorOf(fixtures.alice, fixtures.orgId);
    await expect(assertCan(actor, "read", fixtures.resource)).rejects.toMatchObject({
      name: "PolicyError",
      code: "forbidden",
    });
  });
});
