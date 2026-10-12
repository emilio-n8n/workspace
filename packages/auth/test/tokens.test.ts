import { randomUUID } from "node:crypto";
import { closeDb, getDb, schema } from "@workspace/database";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  API_TOKEN_DEFAULT_TTL_MS,
  authenticateApiToken,
  issueApiToken,
  listApiTokens,
  revokeApiToken,
  tokenHasScope,
} from "../src/tokens";

const { user, organization, apiTokens } = schema;

let counter = 0;
const tag = (p: string) => `${p}${++counter}_${randomUUID().slice(0, 8)}`;

type Fixtures = { orgId: string; userId: string };

async function createFixtures(): Promise<Fixtures> {
  const db = getDb();
  const now = new Date();
  const orgId = tag("org");
  const userId = tag("usr");

  await db
    .insert(organization)
    .values({ id: orgId, name: tag("Org "), slug: orgId, createdAt: now });
  await db.insert(user).values({
    id: userId,
    name: "Agent Test",
    email: `${userId}@example.org`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });

  return { orgId, userId };
}

async function cleanup(f: Fixtures): Promise<void> {
  const db = getDb();
  await db.delete(apiTokens).where(eq(apiTokens.userId, f.userId));
  await db.delete(user).where(eq(user.id, f.userId));
  await db.delete(organization).where(eq(organization.id, f.orgId));
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

describe("jetons d'API — émission et authentification", () => {
  it("émet un jeton, l'authentifie, et ne stocke jamais le clair", async () => {
    const issued = await issueApiToken({
      userId: fixtures.userId,
      orgId: fixtures.orgId,
      name: "Agent CI",
      scopes: ["drive:read"],
    });

    expect(issued.token.startsWith("wsk_")).toBe(true);
    expect(issued.token.length).toBeGreaterThan(40);

    const principal = await authenticateApiToken(issued.token);
    expect(principal).not.toBeNull();
    expect(principal?.userId).toBe(fixtures.userId);
    expect(principal?.orgId).toBe(fixtures.orgId);
    expect(principal?.scopes).toEqual(["drive:read"]);

    // La base ne contient que l'empreinte (jamais le jeton en clair).
    const db = getDb();
    const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, issued.id));
    expect(row?.tokenHash).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain(issued.token.slice(8));

    // lastUsedAt mis à jour après authentification.
    const [after] = await db.select().from(apiTokens).where(eq(apiTokens.id, issued.id));
    expect(after?.lastUsedAt).not.toBeNull();
  });

  it("refuse un jeton inconnu, malformé ou révoqué", async () => {
    expect(await authenticateApiToken("wsk_inconnu_mais_assez_long_pour_passer")).toBeNull();
    expect(await authenticateApiToken("pas-un-jeton")).toBeNull();

    const issued = await issueApiToken({
      userId: fixtures.userId,
      orgId: fixtures.orgId,
      name: "À révoquer",
      scopes: ["docs:read"],
    });
    expect(await authenticateApiToken(issued.token)).not.toBeNull();

    expect(await revokeApiToken(fixtures.userId, issued.id)).toBe(true);
    expect(await revokeApiToken(fixtures.userId, issued.id)).toBe(false);
    expect(await authenticateApiToken(issued.token)).toBeNull();
  });

  it("refuse un jeton expiré", async () => {
    const issued = await issueApiToken({
      userId: fixtures.userId,
      orgId: fixtures.orgId,
      name: "Expiré",
      scopes: ["drive:read"],
      expiresAt: new Date(Date.now() - 60_000),
    });
    expect(await authenticateApiToken(issued.token)).toBeNull();
  });

  it("un utilisateur ne peut révoquer que ses propres jetons", async () => {
    const issued = await issueApiToken({
      userId: fixtures.userId,
      orgId: fixtures.orgId,
      name: "Protégé",
      scopes: ["drive:read"],
    });

    expect(await revokeApiToken(tag("usr"), issued.id)).toBe(false);
    expect(await authenticateApiToken(issued.token)).not.toBeNull();
  });

  it("liste ne divulgue jamais l'empreinte ni le jeton", async () => {
    await issueApiToken({
      userId: fixtures.userId,
      orgId: fixtures.orgId,
      name: "Visible",
      scopes: ["drive:read", "docs:read"],
    });

    const list = await listApiTokens(fixtures.userId, fixtures.orgId);
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain("tokenHash");
    expect(list[0]?.prefix.startsWith("wsk_")).toBe(true);
  });

  it("scopes : refus par défaut", async () => {
    const issued = await issueApiToken({
      userId: fixtures.userId,
      orgId: fixtures.orgId,
      name: "Lecture seule",
      scopes: ["drive:read"],
    });
    const principal = await authenticateApiToken(issued.token);
    if (!principal) throw new Error("authentification du jeton impossible");
    expect(tokenHasScope(principal, "drive:read")).toBe(true);
    expect(tokenHasScope(principal, "drive:write")).toBe(false);
    expect(tokenHasScope(principal, "audit:read")).toBe(false);
  });

  it("applique une expiration par défaut de 90 jours", async () => {
    const before = Date.now();
    const issued = await issueApiToken({
      userId: fixtures.userId,
      orgId: fixtures.orgId,
      name: "Expiration par défaut",
      scopes: ["drive:read"],
    });
    const after = Date.now();

    const db = getDb();
    const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, issued.id));
    expect(row?.expiresAt).not.toBeNull();
    const expiresAt = row?.expiresAt?.getTime() ?? 0;
    expect(expiresAt).toBeGreaterThanOrEqual(before + API_TOKEN_DEFAULT_TTL_MS);
    expect(expiresAt).toBeLessThanOrEqual(after + API_TOKEN_DEFAULT_TTL_MS);

    // La projection « liste » expose bien cette expiration.
    const list = await listApiTokens(fixtures.userId, fixtures.orgId);
    expect(list[0]?.expiresAt?.getTime()).toBe(expiresAt);
  });

  it("expiresAt: null émet un jeton sans expiration (échappatoire)", async () => {
    const issued = await issueApiToken({
      userId: fixtures.userId,
      orgId: fixtures.orgId,
      name: "Sans expiration",
      scopes: ["drive:read"],
      expiresAt: null,
    });

    const db = getDb();
    const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, issued.id));
    expect(row?.expiresAt).toBeNull();

    // Un jeton sans expiration reste authentifiable.
    expect(await authenticateApiToken(issued.token)).not.toBeNull();
  });
});
