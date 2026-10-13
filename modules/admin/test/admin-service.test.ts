import { randomUUID } from "node:crypto";
import { classroomAssignments, classroomCourses, classroomSubmissions } from "@workspace/classroom";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import { docsComments, docsDocuments } from "@workspace/docs";
import { driveFiles } from "@workspace/drive";
import type { Actor } from "@workspace/permissions";
import { taskLists, tasks } from "@workspace/tasks";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AdminError,
  addMemberByEmail,
  eraseUserAccount,
  exportUserData,
  getOverview,
  getPolicies,
  listActiveSessions,
  listAudit,
  listMembers,
  removeMember,
  revokeAllSessions,
  revokeSession,
  updateMemberRole,
  updateOrgProfile,
  updatePolicies,
  updateQuota,
} from "../src/index.ts";

const { user, session, organization, member, auditEvents, orgSettings, apiTokens } = coreSchema;

let counter = 0;
const tag = (prefix: string) => `${prefix}${++counter}_${randomUUID().slice(0, 8)}`;

type Fixtures = {
  orgId: string;
  owner: string;
  adminUser: string;
  simpleUser: string;
  outsider: string;
  outsiderEmail: string;
  actorOwner: Actor;
  actorAdmin: Actor;
  actorSimple: Actor;
};

async function createFixtures(): Promise<Fixtures> {
  const db = getDb();
  const now = new Date();

  const orgId = tag("org");
  await db
    .insert(organization)
    .values({ id: orgId, name: tag("Org "), slug: orgId, createdAt: now });

  const makeUser = async (name: string) => {
    const id = tag("usr");
    const email = `${id}@example.org`;
    await db.insert(user).values({
      id,
      name,
      email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    return { id, email };
  };

  const owner = await makeUser("Owner");
  const adminUser = await makeUser("Admin");
  const simple = await makeUser("Simple");
  const outsider = await makeUser("Outsider");

  await db.insert(member).values([
    { id: tag("mem"), organizationId: orgId, userId: owner.id, role: "owner", createdAt: now },
    { id: tag("mem"), organizationId: orgId, userId: adminUser.id, role: "admin", createdAt: now },
    { id: tag("mem"), organizationId: orgId, userId: simple.id, role: "member", createdAt: now },
  ]);

  return {
    orgId,
    owner: owner.id,
    adminUser: adminUser.id,
    simpleUser: simple.id,
    outsider: outsider.id,
    outsiderEmail: outsider.email,
    actorOwner: { userId: owner.id, orgId },
    actorAdmin: { userId: adminUser.id, orgId },
    actorSimple: { userId: simple.id, orgId },
  };
}

async function cleanup(f: Fixtures): Promise<void> {
  const db = getDb();
  await db.delete(auditEvents).where(eq(auditEvents.orgId, f.orgId));
  await db.delete(organization).where(eq(organization.id, f.orgId));
  for (const id of [f.owner, f.adminUser, f.simpleUser, f.outsider]) {
    await db.delete(user).where(eq(user.id, id));
  }
}

/** Insère une session directement (le fournisseur d'authentification est hors périmètre). */
async function addSession(
  userId: string,
  overrides: { expiresAt?: Date; ipAddress?: string; userAgent?: string } = {},
): Promise<{ id: string }> {
  const id = tag("ses");
  await getDb()
    .insert(session)
    .values({
      id,
      token: tag("tok"),
      userId,
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ipAddress: overrides.ipAddress ?? "203.0.113.7",
      userAgent: overrides.userAgent ?? "Mozilla/5.0 (Test)",
    });
  return { id };
}

/** Insère un jeton d'API avec un haché factice reconnaissable. */
async function addApiToken(
  userId: string,
  orgId: string,
): Promise<{ prefix: string; tokenHash: string }> {
  const tokenHash = `hash-${randomUUID()}`;
  const prefix = tag("wk_");
  await getDb()
    .insert(apiTokens)
    .values({
      orgId,
      userId,
      name: tag("Jeton "),
      prefix,
      tokenHash,
      scopes: ["drive:read", "docs:read"],
    });
  return { prefix, tokenHash };
}

/** Insère un fichier Drive possédé par l'utilisateur et retourne son id. */
async function addDriveFile(ownerId: string, orgId: string): Promise<string> {
  const [row] = await getDb()
    .insert(driveFiles)
    .values({ orgId, ownerId, kind: "file", name: tag("Fichier "), sizeBytes: 4096 })
    .returning({ id: driveFiles.id });
  if (!row) throw new Error("Fichier de test manquant.");
  return row.id;
}

async function addDocument(params: {
  orgId: string;
  fileId: string;
  createdBy: string;
  title: string;
}): Promise<string> {
  const [row] = await getDb()
    .insert(docsDocuments)
    .values(params)
    .returning({ id: docsDocuments.id });
  if (!row) throw new Error("Document de test manquant.");
  return row.id;
}

async function addAssignedTask(params: {
  orgId: string;
  ownerId: string;
  assigneeId: string;
}): Promise<void> {
  const [list] = await getDb()
    .insert(taskLists)
    .values({ orgId: params.orgId, ownerId: params.ownerId, name: tag("Liste ") })
    .returning({ id: taskLists.id });
  if (!list) throw new Error("Liste de test manquante.");
  await getDb()
    .insert(tasks)
    .values({
      orgId: params.orgId,
      listId: list.id,
      createdBy: params.ownerId,
      assigneeId: params.assigneeId,
      title: tag("Tâche "),
    });
}

async function addSubmission(params: {
  orgId: string;
  ownerId: string;
  studentId: string;
}): Promise<void> {
  const [course] = await getDb()
    .insert(classroomCourses)
    .values({
      orgId: params.orgId,
      name: tag("Cours "),
      joinCode: tag("code"),
      ownerId: params.ownerId,
    })
    .returning({ id: classroomCourses.id });
  if (!course) throw new Error("Cours de test manquant.");
  const [assignment] = await getDb()
    .insert(classroomAssignments)
    .values({ courseId: course.id, title: tag("Devoir ") })
    .returning({ id: classroomAssignments.id });
  if (!assignment) throw new Error("Devoir de test manquant.");
  await getDb().insert(classroomSubmissions).values({
    assignmentId: assignment.id,
    studentId: params.studentId,
    content: "Copie de test",
  });
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

describe("admin — autorisations", () => {
  it("réserve la gestion aux administrateurs", async () => {
    await expect(listMembers(f.actorSimple)).rejects.toThrow(AdminError);
    await expect(getOverview(f.actorSimple)).rejects.toThrow(AdminError);
    await expect(updateOrgProfile(f.actorSimple, { name: "Détournement" })).rejects.toThrow(
      AdminError,
    );
    await expect(listActiveSessions(f.actorSimple)).rejects.toThrow(AdminError);
    await expect(revokeSession(f.actorSimple, "ses_inconnu")).rejects.toThrow(AdminError);
    await expect(revokeAllSessions(f.actorSimple, f.owner)).rejects.toThrow(AdminError);
  });

  it("liste les membres avec leurs rôles", async () => {
    const members = await listMembers(f.actorAdmin);
    expect(members).toHaveLength(3);
    expect(members.find((entry) => entry.userId === f.owner)?.role).toBe("owner");
  });
});

describe("admin — membres", () => {
  it("ajoute un compte existant par e-mail, une seule fois", async () => {
    const added = await addMemberByEmail(f.actorOwner, f.outsiderEmail);
    expect(added.role).toBe("member");
    await expect(addMemberByEmail(f.actorOwner, f.outsiderEmail)).rejects.toThrow(AdminError);
    await expect(addMemberByEmail(f.actorOwner, "inconnu@example.org")).rejects.toThrow(AdminError);
  });

  it("change les rôles mais protège propriétaire et soi-même", async () => {
    await updateMemberRole(f.actorOwner, f.simpleUser, "admin");
    const members = await listMembers(f.actorOwner);
    expect(members.find((entry) => entry.userId === f.simpleUser)?.role).toBe("admin");

    await expect(updateMemberRole(f.actorOwner, f.owner, "member")).rejects.toThrow(AdminError);
    await expect(updateMemberRole(f.actorOwner, f.owner, "admin")).rejects.toThrow(AdminError);
  });

  it("retire un membre sans toucher au propriétaire", async () => {
    await removeMember(f.actorOwner, f.simpleUser);
    expect((await listMembers(f.actorOwner)).some((entry) => entry.userId === f.simpleUser)).toBe(
      false,
    );
    await expect(removeMember(f.actorOwner, f.owner)).rejects.toThrow(AdminError);
  });
});

describe("admin — organisation", () => {
  it("met à jour le profil, le quota et retourne la synthèse", async () => {
    await updateOrgProfile(f.actorOwner, { name: "Organisation E2E" });
    await updateQuota(f.actorOwner, 5 * 1024 * 1024 * 1024);

    const overview = await getOverview(f.actorOwner);
    expect(overview.org.name).toBe("Organisation E2E");
    expect(overview.memberCount).toBe(3);
    expect(overview.quotaBytes).toBe(5 * 1024 * 1024 * 1024);

    await updateQuota(f.actorOwner, null);
    expect((await getOverview(f.actorOwner)).quotaBytes).toBeNull();
  });

  it("filtre le journal d'audit par organisation", async () => {
    const db = getDb();
    await db.insert(auditEvents).values({
      orgId: f.orgId,
      actorUserId: f.owner,
      action: "test.action",
      result: "success",
    });
    const entries = await listAudit(f.actorOwner, 10);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.action).toBe("test.action");
  });
});

describe("admin — sessions actives", () => {
  it("liste les sessions actives des membres uniquement", async () => {
    const active = await addSession(f.simpleUser, {
      ipAddress: "198.51.100.4",
      userAgent: "Firefox/128.0",
    });
    await addSession(f.simpleUser, { expiresAt: new Date(Date.now() - 60_000) });
    await addSession(f.outsider);

    const sessions = await listActiveSessions(f.actorAdmin);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: active.id,
      userId: f.simpleUser,
      userName: "Simple",
      userEmail: `${f.simpleUser}@example.org`,
      ipAddress: "198.51.100.4",
      userAgent: "Firefox/128.0",
    });
    expect(new Date(sessions[0]?.expiresAt ?? 0).getTime()).toBeGreaterThan(Date.now());
  });

  it("révoque une session de membre et refuse étrangère ou personnelle", async () => {
    const db = getDb();
    const target = await addSession(f.simpleUser);
    await revokeSession(f.actorOwner, target.id);
    expect(await db.select().from(session).where(eq(session.id, target.id))).toHaveLength(0);

    const foreign = await addSession(f.outsider);
    await expect(revokeSession(f.actorOwner, foreign.id)).rejects.toThrow(AdminError);
    await expect(revokeSession(f.actorOwner, "ses_inconnu")).rejects.toThrow(AdminError);

    const own = await addSession(f.owner);
    await expect(revokeSession(f.actorOwner, own.id)).rejects.toThrow(/Se déconnecter/);
    expect(await db.select().from(session).where(eq(session.id, own.id))).toHaveLength(1);
  });

  it("révoque toutes les sessions d'un membre sauf celle de l'acteur", async () => {
    const db = getDb();
    await addSession(f.simpleUser);
    await addSession(f.simpleUser);
    const peer = await addSession(f.owner);
    const own = await addSession(f.adminUser);

    const result = await revokeAllSessions(f.actorAdmin, f.simpleUser);
    expect(result.revoked).toBe(2);
    expect(await db.select().from(session).where(eq(session.userId, f.simpleUser))).toHaveLength(0);
    expect(await db.select().from(session).where(eq(session.id, peer.id))).toHaveLength(1);
    expect(await db.select().from(session).where(eq(session.id, own.id))).toHaveLength(1);

    // Cibler l'acteur lui-même ne touche jamais ses propres sessions.
    expect(await revokeAllSessions(f.actorAdmin, f.adminUser)).toEqual({ revoked: 0 });
    expect(await db.select().from(session).where(eq(session.id, own.id))).toHaveLength(1);

    await expect(revokeAllSessions(f.actorAdmin, f.outsider)).rejects.toThrow(AdminError);
  });
});

describe("admin — politiques", () => {
  it("retourne les valeurs par défaut sans ligne de réglages", async () => {
    const db = getDb();
    expect(await db.select().from(orgSettings).where(eq(orgSettings.orgId, f.orgId))).toHaveLength(
      0,
    );

    await expect(getPolicies(f.actorAdmin)).resolves.toEqual({
      allowExternalSharing: true,
      versionRetentionDays: 90,
      storageQuotaBytes: null,
    });
  });

  it("persiste les politiques, préserve le quota et journalise l'action", async () => {
    await updatePolicies(f.actorAdmin, { versionRetentionDays: 30 });
    await updateQuota(f.actorOwner, 2 * 1024 ** 3);
    await updatePolicies(f.actorAdmin, { allowExternalSharing: false });

    await expect(getPolicies(f.actorOwner)).resolves.toEqual({
      allowExternalSharing: false,
      versionRetentionDays: 30,
      storageQuotaBytes: 2 * 1024 ** 3,
    });

    const entries = (await listAudit(f.actorOwner, 10)).filter(
      (entry) => entry.action === "admin.policies.update",
    );
    expect(entries).toHaveLength(2);
    const metadata = entries.map((entry) => entry.metadata);
    expect(metadata).toContainEqual({ versionRetentionDays: 30 });
    expect(metadata).toContainEqual({ allowExternalSharing: false });
  });

  it("refuse rétention hors bornes et membres non administrateurs", async () => {
    await expect(updatePolicies(f.actorOwner, { versionRetentionDays: 6 })).rejects.toThrow(
      AdminError,
    );
    await expect(updatePolicies(f.actorOwner, { versionRetentionDays: 3651 })).rejects.toThrow(
      AdminError,
    );
    await expect(updatePolicies(f.actorOwner, { versionRetentionDays: 30.5 })).rejects.toThrow(
      AdminError,
    );

    await expect(getPolicies(f.actorSimple)).rejects.toThrow(AdminError);
    await expect(updatePolicies(f.actorSimple, { allowExternalSharing: false })).rejects.toThrow(
      AdminError,
    );

    // Les bornes elles-mêmes restent acceptées.
    await updatePolicies(f.actorOwner, { versionRetentionDays: 7 });
    await updatePolicies(f.actorOwner, { versionRetentionDays: 3650 });
    expect((await getPolicies(f.actorOwner)).versionRetentionDays).toBe(3650);
  });
});

describe("admin — centre de conformité (RGPD)", () => {
  it("exporte les données d'un membre sans divulguer les secrets", async () => {
    const token = await addApiToken(f.simpleUser, f.orgId);
    await addSession(f.simpleUser, {
      ipAddress: "198.51.100.9",
      userAgent: "Conformité/1.0",
    });
    const fileId = await addDriveFile(f.simpleUser, f.orgId);
    const documentId = await addDocument({
      orgId: f.orgId,
      fileId,
      createdBy: f.simpleUser,
      title: "Notes de test",
    });
    await getDb().insert(docsComments).values({
      documentId,
      authorId: f.simpleUser,
      body: "Commentaire de test",
    });
    await addAssignedTask({ orgId: f.orgId, ownerId: f.owner, assigneeId: f.simpleUser });
    await addSubmission({ orgId: f.orgId, ownerId: f.owner, studentId: f.simpleUser });

    const { filename, json } = await exportUserData(f.actorOwner, f.simpleUser);

    const today = new Date().toISOString().slice(0, 10);
    expect(filename).toBe(`donnees-${f.simpleUser}@example.org-${today}.json`);
    const bundle = JSON.parse(json) as Record<string, unknown>;
    expect(Object.keys(bundle).sort()).toEqual(
      [
        "apiTokens",
        "auditEvents",
        "counts",
        "documents",
        "driveFiles",
        "exportedAt",
        "memberships",
        "sessions",
        "user",
      ].sort(),
    );
    expect(bundle.user).toMatchObject({ id: f.simpleUser, name: "Simple" });
    expect(bundle.memberships).toEqual([
      { organizationId: f.orgId, role: "member", createdAt: expect.any(String) },
    ]);
    expect(bundle.sessions).toEqual([
      { createdAt: expect.any(String), ipAddress: "198.51.100.9", userAgent: "Conformité/1.0" },
    ]);
    expect(bundle.apiTokens).toEqual([
      {
        name: expect.any(String),
        prefix: token.prefix,
        scopes: ["drive:read", "docs:read"],
        createdAt: expect.any(String),
        lastUsedAt: null,
        revokedAt: null,
      },
    ]);
    expect(bundle.driveFiles).toEqual([
      {
        name: expect.any(String),
        sizeBytes: 4096,
        createdAt: expect.any(String),
        trashed: false,
      },
    ]);
    expect(bundle.documents).toEqual([{ title: "Notes de test", updatedAt: expect.any(String) }]);
    expect(bundle.counts).toEqual({ comments: 1, tasksAssigned: 1, submissions: 1 });
    expect(bundle.auditEvents).toEqual([]);

    // Ni haché de jeton, ni jeton de session ne traversent la frontière.
    expect(json).not.toContain(token.tokenHash);
    expect(json).not.toContain("tokenHash");
    expect(json).not.toContain("token_hash");
  });

  it("pseudonymise le compte, supprime sessions et jetons et conserve les contenus", async () => {
    const db = getDb();
    await addApiToken(f.simpleUser, f.orgId);
    await addSession(f.simpleUser);
    const fileId = await addDriveFile(f.simpleUser, f.orgId);
    const documentId = await addDocument({
      orgId: f.orgId,
      fileId,
      createdBy: f.simpleUser,
      title: "Document à conserver",
    });

    await expect(
      eraseUserAccount(f.actorOwner, f.simpleUser, { confirm: "EFFACER" }),
    ).resolves.toEqual({ ok: true });

    const [row] = await db.select().from(user).where(eq(user.id, f.simpleUser));
    expect(row?.name).toBe("Compte effacé");
    expect(row?.email).toMatch(/^efface-[0-9a-f-]{36}@invalid\.local$/);
    expect(row?.emailVerified).toBe(false);

    // Les identifiants de connexion sont supprimés définitivement.
    expect(await db.select().from(session).where(eq(session.userId, f.simpleUser))).toHaveLength(0);
    expect(
      await db.select().from(apiTokens).where(eq(apiTokens.userId, f.simpleUser)),
    ).toHaveLength(0);

    // L'appartenance et les contenus restent : pseudonymisation, pas suppression.
    expect(
      await db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, f.orgId), eq(member.userId, f.simpleUser))),
    ).toHaveLength(1);
    expect(await db.select().from(driveFiles).where(eq(driveFiles.id, fileId))).toHaveLength(1);
    expect(
      await db.select().from(docsDocuments).where(eq(docsDocuments.id, documentId)),
    ).toHaveLength(1);
  });

  it("refuse l'effacement du propriétaire, de soi-même ou sans confirmation", async () => {
    const db = getDb();

    await expect(eraseUserAccount(f.actorOwner, f.simpleUser, { confirm: "oui" })).rejects.toThrow(
      /Confirmation/,
    );
    const [unchanged] = await db.select().from(user).where(eq(user.id, f.simpleUser));
    expect(unchanged?.name).toBe("Simple");
    expect(unchanged?.email).toBe(`${f.simpleUser}@example.org`);

    await expect(eraseUserAccount(f.actorOwner, f.owner, { confirm: "EFFACER" })).rejects.toThrow(
      /propriétaire/,
    );
    await expect(
      eraseUserAccount(f.actorAdmin, f.adminUser, { confirm: "EFFACER" }),
    ).rejects.toThrow(/propre compte/);

    // Un administrateur ne peut pas effacer un autre administrateur.
    await updateMemberRole(f.actorOwner, f.simpleUser, "admin");
    await expect(
      eraseUserAccount(f.actorAdmin, f.simpleUser, { confirm: "EFFACER" }),
    ).rejects.toThrow(/Seul le propriétaire/);
  });

  it("réserve export et effacement aux administrateurs, dans leur organisation", async () => {
    await expect(exportUserData(f.actorSimple, f.simpleUser)).rejects.toThrow(AdminError);
    await expect(
      eraseUserAccount(f.actorSimple, f.simpleUser, { confirm: "EFFACER" }),
    ).rejects.toThrow(AdminError);

    // Cible hors organisation : introuvable, même pour un administrateur.
    await expect(exportUserData(f.actorAdmin, f.outsider)).rejects.toThrow(AdminError);
    await expect(
      eraseUserAccount(f.actorAdmin, f.outsider, { confirm: "EFFACER" }),
    ).rejects.toThrow(AdminError);

    // Contrôle positif : un administrateur exporte un membre de son organisation.
    await expect(exportUserData(f.actorAdmin, f.simpleUser)).resolves.toMatchObject({
      filename: expect.stringMatching(/^donnees-.*\.json$/),
    });
  });

  it("journalise l'export et l'effacement dans le journal d'audit", async () => {
    await exportUserData(f.actorOwner, f.simpleUser);
    await eraseUserAccount(f.actorOwner, f.simpleUser, { confirm: "EFFACER" });

    const entries = await listAudit(f.actorOwner, 50);
    for (const action of ["admin.compliance.export", "admin.compliance.erase"]) {
      const entry = entries.find((row) => row.action === action);
      expect(entry).toMatchObject({
        actorUserId: f.owner,
        resourceType: "user",
        resourceId: f.simpleUser,
        result: "success",
        metadata: { targetUserId: f.simpleUser },
      });
    }
  });
});
