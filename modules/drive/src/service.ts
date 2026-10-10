import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getServerEnv } from "@workspace/config";
import { getDb, withTransaction } from "@workspace/database";
import {
  type Actor,
  createGrant,
  type GrantRole,
  type GrantSubject,
  listGrants,
  type ResourceGrantRow,
  resolveRole,
  revokeGrant,
  roleSatisfies,
} from "@workspace/permissions";
import { getStorage, orgKey } from "@workspace/storage";
import { and, asc, desc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import {
  type DriveEntry,
  type DriveVersion,
  driveFiles,
  driveFileVersions,
  driveShareLinks,
} from "./schema.ts";

export type DriveErrorCode = "not_found" | "forbidden" | "validation" | "conflict";

export class DriveError extends Error {
  readonly code: DriveErrorCode;
  constructor(code: DriveErrorCode, message: string) {
    super(message);
    this.name = "DriveError";
    this.code = code;
  }
}

const MAX_DEPTH = 32;
const LINK_ROLES: readonly GrantRole[] = ["viewer", "editor"];

const db = () => getDb();
const storage = () => getStorage();

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code === "23505" || candidate?.cause?.code === "23505";
}

function assertValidName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 255) {
    throw new DriveError("validation", "Le nom doit contenir entre 1 et 255 caractères.");
  }
  const hasForbiddenChar = [...trimmed].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || char === "/" || char === "\\";
  });
  if (hasForbiddenChar) {
    throw new DriveError("validation", "Le nom contient des caractères interdits.");
  }
  return trimmed;
}

function sha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

/** Échappe les caractères spéciaux LIKE (%, _) pour une recherche littérale. */
function escapeLike(query: string): string {
  return query.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * Rôle effectif : propriétaire, sinon grants hérités (élément → dossier parent → …).
 * Interprétation des grants propre au module (voir docs/architecture/module-boundaries.md).
 */
export async function effectiveRole(actor: Actor, entryId: string): Promise<GrantRole | null> {
  let currentId: string | null = entryId;
  let depth = 0;

  while (currentId && depth < MAX_DEPTH) {
    const [entry] = await db()
      .select({
        ownerId: driveFiles.ownerId,
        parentId: driveFiles.parentId,
        orgId: driveFiles.orgId,
      })
      .from(driveFiles)
      .where(eq(driveFiles.id, currentId))
      .limit(1);

    if (!entry || entry.orgId !== actor.orgId) return null;
    if (entry.ownerId === actor.userId) return "owner";

    const role = await resolveRole(actor, {
      type: "file",
      id: currentId,
      orgId: actor.orgId,
    });
    if (role) return role;

    currentId = entry.parentId;
    depth += 1;
  }

  return null;
}

async function assertDrive(
  actor: Actor,
  action: "read" | "write" | "share" | "delete",
  entryId: string,
  options: { allowTrashed?: boolean } = {},
): Promise<DriveEntry> {
  const [entry] = await db()
    .select()
    .from(driveFiles)
    .where(and(eq(driveFiles.id, entryId), eq(driveFiles.orgId, actor.orgId)))
    .limit(1);

  if (!entry) throw new DriveError("not_found", "Élément introuvable.");
  if (!options.allowTrashed && entry.status !== "active") {
    throw new DriveError("not_found", "Élément introuvable.");
  }

  const role = await effectiveRole(actor, entryId);
  if (!roleSatisfies(role, action)) {
    throw new DriveError("forbidden", "Permission insuffisante sur cet élément.");
  }
  return entry;
}

async function assertWritableParent(actor: Actor, parentId: string | null): Promise<void> {
  if (!parentId) return;
  const parent = await assertDrive(actor, "write", parentId);
  if (parent.kind !== "folder") {
    throw new DriveError("validation", "Le parent doit être un dossier.");
  }
}

/** Identifiants du sous-arbre (incluant la racine) — pour corbeille, restauration, purge. */
async function collectSubtree(orgId: string, rootId: string): Promise<string[]> {
  const all = [rootId];
  let frontier = [rootId];

  while (frontier.length > 0) {
    const children = await db()
      .select({ id: driveFiles.id })
      .from(driveFiles)
      .where(and(eq(driveFiles.orgId, orgId), inArray(driveFiles.parentId, frontier)));
    const ids = children.map((child) => child.id);
    all.push(...ids);
    frontier = ids;
  }

  return all;
}

// ---------------------------------------------------------------------------
// Dossiers et fichiers
// ---------------------------------------------------------------------------

export async function createFolder(
  actor: Actor,
  input: { parentId?: string | null; name: string },
): Promise<DriveEntry> {
  const name = assertValidName(input.name);
  const parentId = input.parentId ?? null;
  await assertWritableParent(actor, parentId);

  try {
    const [row] = await db()
      .insert(driveFiles)
      .values({ orgId: actor.orgId, ownerId: actor.userId, parentId, kind: "folder", name })
      .returning();
    if (!row) throw new DriveError("conflict", "Création impossible.");
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DriveError("conflict", "Un élément portant ce nom existe déjà ici.");
    }
    throw error;
  }
}

/** Liste les éléments visibles d'un dossier (propriétaire ou grant hérité). */
export async function listEntries(
  actor: Actor,
  input: { parentId?: string | null } = {},
): Promise<DriveEntry[]> {
  const parentId = input.parentId ?? null;
  const rows = await db()
    .select()
    .from(driveFiles)
    .where(
      and(
        eq(driveFiles.orgId, actor.orgId),
        eq(driveFiles.status, "active"),
        parentId === null ? isNull(driveFiles.parentId) : eq(driveFiles.parentId, parentId),
      ),
    )
    .orderBy(sql`case when ${driveFiles.kind} = 'folder' then 0 else 1 end`, asc(driveFiles.name));

  const visible: DriveEntry[] = [];
  for (const row of rows) {
    if (row.ownerId === actor.userId) {
      visible.push(row);
      continue;
    }
    const role = await effectiveRole(actor, row.id);
    if (roleSatisfies(role, "read")) visible.push(row);
  }
  return visible;
}

export async function getEntry(
  actor: Actor,
  entryId: string,
  options: { allowTrashed?: boolean } = {},
): Promise<DriveEntry> {
  return assertDrive(actor, "read", entryId, options);
}

/** Corbeille personnelle : éléments dont l'acteur est propriétaire (MVP). */
export async function listTrash(actor: Actor): Promise<DriveEntry[]> {
  return db()
    .select()
    .from(driveFiles)
    .where(
      and(
        eq(driveFiles.orgId, actor.orgId),
        eq(driveFiles.ownerId, actor.userId),
        eq(driveFiles.status, "trashed"),
      ),
    )
    .orderBy(desc(driveFiles.trashedAt));
}

/** Recherche littérale par nom parmi les fichiers accessibles (agents, UI). */
export async function searchEntries(
  actor: Actor,
  input: { query: string; limit?: number },
): Promise<DriveEntry[]> {
  const query = input.query.trim();
  if (query.length === 0) return [];

  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);

  const rows = await db()
    .select()
    .from(driveFiles)
    .where(
      and(
        eq(driveFiles.orgId, actor.orgId),
        eq(driveFiles.status, "active"),
        eq(driveFiles.kind, "file"),
        ilike(driveFiles.name, `%${escapeLike(query)}%`),
      ),
    )
    .orderBy(desc(driveFiles.updatedAt))
    .limit(100);

  const visible: DriveEntry[] = [];
  for (const row of rows) {
    if (visible.length >= limit) break;
    if (row.ownerId === actor.userId) {
      visible.push(row);
      continue;
    }
    const role = await effectiveRole(actor, row.id);
    if (roleSatisfies(role, "read")) visible.push(row);
  }
  return visible;
}

export async function uploadFile(
  actor: Actor,
  input: { parentId?: string | null; name: string; contentType?: string; body: Buffer },
): Promise<{ entry: DriveEntry; version: DriveVersion }> {
  const name = assertValidName(input.name);
  const env = getServerEnv();

  if (input.body.length === 0) throw new DriveError("validation", "Fichier vide.");
  if (input.body.length > env.MAX_UPLOAD_BYTES) {
    throw new DriveError(
      "validation",
      `Fichier trop volumineux (maximum ${Math.floor(env.MAX_UPLOAD_BYTES / (1024 * 1024))} Mo).`,
    );
  }

  const parentId = input.parentId ?? null;
  await assertWritableParent(actor, parentId);

  const checksum = sha256(input.body);
  const key = orgKey(actor.orgId, randomUUID(), name);
  await storage().put({ key, body: input.body, contentType: input.contentType });

  try {
    return await withTransaction(async (tx) => {
      const [entry] = await tx
        .insert(driveFiles)
        .values({
          orgId: actor.orgId,
          ownerId: actor.userId,
          parentId,
          kind: "file",
          name,
          mimeType: input.contentType ?? null,
          sizeBytes: input.body.length,
          storageKey: key,
          checksum,
        })
        .returning();
      if (!entry) throw new DriveError("conflict", "Upload impossible.");

      const [version] = await tx
        .insert(driveFileVersions)
        .values({
          fileId: entry.id,
          version: 1,
          storageKey: key,
          sizeBytes: input.body.length,
          checksum,
          createdBy: actor.userId,
        })
        .returning();
      if (!version) throw new DriveError("conflict", "Upload impossible.");

      return { entry, version };
    });
  } catch (error) {
    await storage()
      .delete(key)
      .catch(() => undefined);
    if (isUniqueViolation(error)) {
      throw new DriveError("conflict", "Un élément portant ce nom existe déjà ici.");
    }
    throw error;
  }
}

/**
 * Crée une entrée fichier « pointeur » : le contenu appartient à un autre module
 * (Docs, etc.) et vit dans ses propres tables. Aucun binaire n'est stocké ici.
 */
export async function createLinkedFile(
  actor: Actor,
  input: { parentId?: string | null; name: string; mimeType: string; sizeBytes?: number | null },
): Promise<DriveEntry> {
  const name = assertValidName(input.name);
  const parentId = input.parentId ?? null;
  await assertWritableParent(actor, parentId);

  try {
    const [row] = await db()
      .insert(driveFiles)
      .values({
        orgId: actor.orgId,
        ownerId: actor.userId,
        parentId,
        kind: "file",
        name,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes ?? null,
      })
      .returning();
    if (!row) throw new DriveError("conflict", "Création impossible.");
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DriveError("conflict", "Un élément portant ce nom existe déjà ici.");
    }
    throw error;
  }
}

/** Met à jour l'horodatage d'un élément (aperçu « modifié récemment »). */
export async function touchEntry(actor: Actor, entryId: string): Promise<void> {
  await assertDrive(actor, "write", entryId);
  await db().update(driveFiles).set({ updatedAt: new Date() }).where(eq(driveFiles.id, entryId));
}

export async function download(
  actor: Actor,
  fileId: string,
): Promise<{ entry: DriveEntry; body: Buffer }> {
  const entry = await assertDrive(actor, "read", fileId);
  if (entry.kind !== "file" || !entry.storageKey) {
    throw new DriveError("validation", "Cet élément n'est pas un fichier téléchargeable.");
  }

  const body = await storage().get(entry.storageKey);
  if (!body) throw new DriveError("not_found", "Contenu introuvable dans le stockage.");
  return { entry, body };
}

/** Remplace le contenu d'un fichier → nouvelle version (les anciennes restent accessibles). */
export async function replaceContent(
  actor: Actor,
  fileId: string,
  input: { contentType?: string; body: Buffer },
): Promise<{ entry: DriveEntry; version: DriveVersion }> {
  const entry = await assertDrive(actor, "write", fileId);
  if (entry.kind !== "file") {
    throw new DriveError("validation", "Seul un fichier peut être remplacé.");
  }

  const env = getServerEnv();
  if (input.body.length === 0) throw new DriveError("validation", "Fichier vide.");
  if (input.body.length > env.MAX_UPLOAD_BYTES) {
    throw new DriveError("validation", "Fichier trop volumineux.");
  }

  const checksum = sha256(input.body);
  const key = orgKey(actor.orgId, randomUUID(), entry.name);
  await storage().put({ key, body: input.body, contentType: input.contentType });

  return withTransaction(async (tx) => {
    const [highest] = await tx
      .select({ max: sql<number>`coalesce(max(${driveFileVersions.version}), 0)`.mapWith(Number) })
      .from(driveFileVersions)
      .where(eq(driveFileVersions.fileId, fileId));

    const nextVersion = (highest?.max ?? 0) + 1;

    const [version] = await tx
      .insert(driveFileVersions)
      .values({
        fileId,
        version: nextVersion,
        storageKey: key,
        sizeBytes: input.body.length,
        checksum,
        createdBy: actor.userId,
      })
      .returning();
    if (!version) throw new DriveError("conflict", "Version impossible à créer.");

    const [updated] = await tx
      .update(driveFiles)
      .set({
        storageKey: key,
        sizeBytes: input.body.length,
        checksum,
        mimeType: input.contentType ?? entry.mimeType,
      })
      .where(eq(driveFiles.id, fileId))
      .returning();
    if (!updated) throw new DriveError("conflict", "Mise à jour impossible.");

    return { entry: updated, version };
  });
}

export async function rename(actor: Actor, entryId: string, name: string): Promise<DriveEntry> {
  const clean = assertValidName(name);
  await assertDrive(actor, "write", entryId);

  try {
    const [row] = await db()
      .update(driveFiles)
      .set({ name: clean })
      .where(eq(driveFiles.id, entryId))
      .returning();
    if (!row) throw new DriveError("not_found", "Élément introuvable.");
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DriveError("conflict", "Un élément portant ce nom existe déjà ici.");
    }
    throw error;
  }
}

export async function trash(actor: Actor, entryId: string): Promise<void> {
  await assertDrive(actor, "write", entryId);
  const ids = await collectSubtree(actor.orgId, entryId);
  await db()
    .update(driveFiles)
    .set({ status: "trashed", trashedAt: new Date() })
    .where(and(eq(driveFiles.orgId, actor.orgId), inArray(driveFiles.id, ids)));
}

export async function restore(actor: Actor, entryId: string): Promise<void> {
  await assertDrive(actor, "write", entryId, { allowTrashed: true });
  const ids = await collectSubtree(actor.orgId, entryId);
  await db()
    .update(driveFiles)
    .set({ status: "active", trashedAt: null })
    .where(and(eq(driveFiles.orgId, actor.orgId), inArray(driveFiles.id, ids)));
}

/** Purge définitive (corbeille uniquement) : supprime le contenu du stockage puis les lignes. */
export async function purge(actor: Actor, entryId: string): Promise<void> {
  const entry = await assertDrive(actor, "delete", entryId, { allowTrashed: true });
  if (entry.status !== "trashed") {
    throw new DriveError("validation", "Un élément doit être dans la corbeille pour être purgé.");
  }

  const ids = await collectSubtree(actor.orgId, entryId);

  const files = await db()
    .select({ id: driveFiles.id, storageKey: driveFiles.storageKey })
    .from(driveFiles)
    .where(
      and(
        eq(driveFiles.orgId, actor.orgId),
        inArray(driveFiles.id, ids),
        eq(driveFiles.kind, "file"),
      ),
    );

  const versions = files.length
    ? await db()
        .select({ storageKey: driveFileVersions.storageKey })
        .from(driveFileVersions)
        .where(
          inArray(
            driveFileVersions.fileId,
            files.map((file) => file.id),
          ),
        )
    : [];

  const keys = new Set<string>();
  for (const file of files) if (file.storageKey) keys.add(file.storageKey);
  for (const version of versions) keys.add(version.storageKey);

  for (const key of keys) {
    await storage().delete(key);
  }

  await db()
    .delete(driveFiles)
    .where(and(eq(driveFiles.orgId, actor.orgId), eq(driveFiles.id, entryId)));
}

export async function listVersions(actor: Actor, fileId: string): Promise<DriveVersion[]> {
  await assertDrive(actor, "read", fileId);
  return db()
    .select()
    .from(driveFileVersions)
    .where(eq(driveFileVersions.fileId, fileId))
    .orderBy(desc(driveFileVersions.version));
}

/** Chaîne d'ancêtres (du plus haut au plus proche) — affichage du fil d'Ariane. */
export async function getAncestors(actor: Actor, entryId: string): Promise<DriveEntry[]> {
  const chain: DriveEntry[] = [];
  let current: string | null = entryId;
  let depth = 0;

  while (current && depth < MAX_DEPTH) {
    const [row] = await db()
      .select()
      .from(driveFiles)
      .where(and(eq(driveFiles.id, current), eq(driveFiles.orgId, actor.orgId)))
      .limit(1);
    if (!row) break;

    chain.unshift(row);
    current = row.parentId;
    depth += 1;
  }

  return chain;
}

// ---------------------------------------------------------------------------
// Partage (utilisateurs, groupes, liens)
// ---------------------------------------------------------------------------

export async function shareEntry(
  actor: Actor,
  entryId: string,
  input: { subject: GrantSubject; role: GrantRole },
): Promise<ResourceGrantRow | null> {
  await assertDrive(actor, "share", entryId);
  return createGrant({
    resource: { type: "file", id: entryId, orgId: actor.orgId },
    subject: input.subject,
    role: input.role,
    actor,
  });
}

export async function unshareEntry(
  actor: Actor,
  entryId: string,
  grantId: string,
): Promise<boolean> {
  await assertDrive(actor, "share", entryId);
  return revokeGrant(grantId);
}

export async function listEntryGrants(actor: Actor, entryId: string): Promise<ResourceGrantRow[]> {
  await assertDrive(actor, "share", entryId);
  return listGrants({ type: "file", id: entryId, orgId: actor.orgId });
}

export type ShareLinkRow = {
  id: string;
  role: GrantRole;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

/** Liens de partage d'un élément (actifs et révoqués — jamais le jeton en clair). */
export async function listShareLinks(actor: Actor, entryId: string): Promise<ShareLinkRow[]> {
  await assertDrive(actor, "share", entryId);
  return db()
    .select({
      id: driveShareLinks.id,
      role: driveShareLinks.role,
      createdAt: driveShareLinks.createdAt,
      lastUsedAt: driveShareLinks.lastUsedAt,
      expiresAt: driveShareLinks.expiresAt,
      revokedAt: driveShareLinks.revokedAt,
    })
    .from(driveShareLinks)
    .where(eq(driveShareLinks.fileId, entryId))
    .orderBy(desc(driveShareLinks.createdAt));
}

export async function createShareLink(
  actor: Actor,
  entryId: string,
  input: { role: GrantRole; expiresAt?: Date | null },
): Promise<{ id: string; token: string }> {
  const entry = await assertDrive(actor, "share", entryId);
  if (!LINK_ROLES.includes(input.role)) {
    throw new DriveError("validation", "Rôle du lien invalide (viewer ou editor).");
  }

  const token = randomBytes(24).toString("base64url");
  const tokenHash = sha256(Buffer.from(token));

  const [row] = await db()
    .insert(driveShareLinks)
    .values({
      fileId: entry.id,
      role: input.role,
      tokenHash,
      createdBy: actor.userId,
      expiresAt: input.expiresAt ?? null,
    })
    .returning({ id: driveShareLinks.id });

  if (!row) throw new DriveError("conflict", "Création du lien impossible.");
  return { id: row.id, token };
}

export async function revokeShareLink(actor: Actor, linkId: string): Promise<boolean> {
  const [link] = await db()
    .select()
    .from(driveShareLinks)
    .where(eq(driveShareLinks.id, linkId))
    .limit(1);
  if (!link) return false;

  await assertDrive(actor, "share", link.fileId);

  const rows = await db()
    .update(driveShareLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(driveShareLinks.id, linkId), isNull(driveShareLinks.revokedAt)))
    .returning({ id: driveShareLinks.id });
  return rows.length > 0;
}

/** Accès à un élément via un lien de partage (capability token, sans compte). */
export async function accessShareLink(
  token: string,
): Promise<{ entry: DriveEntry; role: GrantRole } | null> {
  if (!token || token.length < 16) return null;

  const tokenHash = sha256(Buffer.from(token));
  const [link] = await db()
    .select()
    .from(driveShareLinks)
    .where(eq(driveShareLinks.tokenHash, tokenHash))
    .limit(1);

  if (!link || link.revokedAt) return null;
  if (link.expiresAt && link.expiresAt < new Date()) return null;

  const [entry] = await db()
    .select()
    .from(driveFiles)
    .where(and(eq(driveFiles.id, link.fileId), eq(driveFiles.status, "active")))
    .limit(1);
  if (!entry) return null;

  await db()
    .update(driveShareLinks)
    .set({ lastUsedAt: new Date() })
    .where(eq(driveShareLinks.id, link.id));

  return { entry, role: link.role };
}
