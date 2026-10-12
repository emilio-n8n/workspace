import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getServerEnv } from "@workspace/config";
import { schema as coreSchema, getDb, withTransaction } from "@workspace/database";
import {
  type Actor,
  createGrant,
  type GrantRole,
  type GrantSubject,
  highestRole,
  listGrantedResourceIds,
  listGrants,
  type ResourceGrantRow,
  revokeGrant,
  roleSatisfies,
} from "@workspace/permissions";
import { getStorage, orgKey } from "@workspace/storage";
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  type DriveEntry,
  type DriveVersion,
  driveFiles,
  driveFileVersions,
  driveShareLinks,
} from "./schema.ts";

export type DriveErrorCode = "not_found" | "forbidden" | "validation" | "conflict" | "quota";

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

/** Rétention des versions (jours) par défaut, si l'organisation n'a pas de réglage. */
const DEFAULT_VERSION_RETENTION_DAYS = 90;

/** Limite d'upload configurée (octets) — lecture paresseuse de l'environnement. */
export function getMaxUploadBytes(): number {
  return getServerEnv().MAX_UPLOAD_BYTES;
}

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
  const roles = await resolveRolesForEntries(actor, [{ id: entryId }]);
  return roles.get(entryId) ?? null;
}

/** Entrée à résoudre : `ownerId` évite une requête supplémentaire pour la propriété. */
export type EntryRoleRef = { id: string; ownerId?: string | null };

type EntryNode = {
  parentId: string | null;
  ownerId: string;
  orgId: string;
};

/**
 * Groupes de l'acteur (équipes de l'organisation active).
 * Même lecture que `@workspace/permissions` — dupliquée volontairement pour ne pas
 * dépendre d'une API non exportée du paquet.
 */
async function loadActorGroupIds(actor: Actor): Promise<Set<string>> {
  if (actor.groupIds) return new Set(actor.groupIds);

  const rows = await db()
    .select({ teamId: coreSchema.teamMember.teamId })
    .from(coreSchema.teamMember)
    .innerJoin(coreSchema.team, eq(coreSchema.teamMember.teamId, coreSchema.team.id))
    .where(
      and(
        eq(coreSchema.teamMember.userId, actor.userId),
        eq(coreSchema.team.organizationId, actor.orgId),
      ),
    );

  return new Set(rows.map((row) => row.teamId));
}

/** Rôle applicable le plus élevé par élément, en une requête pour tout le lot. */
async function loadGrantedRolesByNode(
  actor: Actor,
  nodeIds: readonly string[],
): Promise<Map<string, GrantRole>> {
  const byNode = new Map<string, GrantRole>();
  if (nodeIds.length === 0) return byNode;

  const now = new Date();
  const rows = await db()
    .select({
      resourceId: coreSchema.resourceGrants.resourceId,
      subjectType: coreSchema.resourceGrants.subjectType,
      subjectId: coreSchema.resourceGrants.subjectId,
      role: coreSchema.resourceGrants.role,
    })
    .from(coreSchema.resourceGrants)
    .where(
      and(
        eq(coreSchema.resourceGrants.resourceType, "file"),
        eq(coreSchema.resourceGrants.orgId, actor.orgId),
        inArray(coreSchema.resourceGrants.resourceId, [...nodeIds]),
        or(
          isNull(coreSchema.resourceGrants.expiresAt),
          gt(coreSchema.resourceGrants.expiresAt, now),
        ),
      ),
    );

  if (rows.length === 0) return byNode;

  const hasGroupGrants = rows.some((row) => row.subjectType === "group");
  const groups = hasGroupGrants ? await loadActorGroupIds(actor) : null;

  for (const row of rows) {
    const applies =
      (row.subjectType === "org" && row.subjectId === actor.orgId) ||
      (row.subjectType === "user" && row.subjectId === actor.userId) ||
      (row.subjectType === "group" && (groups?.has(row.subjectId) ?? false));
    if (!applies) continue;
    byNode.set(row.resourceId, highestRole(byNode.get(row.resourceId), row.role) ?? row.role);
  }

  return byNode;
}

/**
 * Rôles effectifs d'un lot d'entrées — remplace la boucle `effectiveRole`
 * O(N × profondeur) des listes par un parcours d'ancêtres par niveaux :
 *
 * 1. propriété (`ownerId === actor.userId`) résolue sans requête ;
 * 2. ascendance commune : BFS par niveaux, une requête par profondeur (≤ 32)
 *    au lieu d'une par entrée et par niveau ;
 * 3. une seule requête de grants sur tout l'ensemble, puis marche entrée → racine
 *    en mémoire (le grant le plus proche prime, comme `effectiveRole`).
 *
 * Un ancêtre absent (supprimé) ou hors organisation annule la résolution (null),
 * exactement comme l'ancienne marche requête par requête.
 */
export async function resolveRolesForEntries(
  actor: Actor,
  entries: readonly EntryRoleRef[],
): Promise<Map<string, GrantRole | null>> {
  const roles = new Map<string, GrantRole | null>();
  if (entries.length === 0) return roles;

  const pending = new Set<string>();
  for (const entry of entries) {
    if (entry.ownerId === actor.userId) roles.set(entry.id, "owner");
    else pending.add(entry.id);
  }
  if (pending.size === 0) return roles;

  const nodes = new Map<string, EntryNode>();
  let frontier = [...pending];
  let depth = 0;

  while (frontier.length > 0 && depth < MAX_DEPTH) {
    const rows = await db()
      .select({
        id: driveFiles.id,
        parentId: driveFiles.parentId,
        ownerId: driveFiles.ownerId,
        orgId: driveFiles.orgId,
      })
      .from(driveFiles)
      .where(and(eq(driveFiles.orgId, actor.orgId), inArray(driveFiles.id, frontier)));

    const next = new Set<string>();
    for (const row of rows) {
      if (nodes.has(row.id)) continue;
      nodes.set(row.id, { parentId: row.parentId, ownerId: row.ownerId, orgId: row.orgId });
      if (row.parentId && !nodes.has(row.parentId)) next.add(row.parentId);
    }

    frontier = [...next];
    depth += 1;
  }

  const grantedByNode = await loadGrantedRolesByNode(actor, [...nodes.keys()]);

  for (const entryId of pending) {
    let current: string | null = entryId;
    let resolved: GrantRole | null = null;
    let steps = 0;

    while (current && steps < MAX_DEPTH) {
      const node = nodes.get(current);
      if (!node || node.orgId !== actor.orgId) {
        resolved = null;
        break;
      }
      if (node.ownerId === actor.userId) {
        resolved = "owner";
        break;
      }
      const granted = grantedByNode.get(current);
      if (granted) {
        resolved = granted;
        break;
      }
      current = node.parentId;
      steps += 1;
    }

    roles.set(entryId, resolved);
  }

  return roles;
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

  const roles = await resolveRolesForEntries(
    actor,
    rows.map((row) => ({ id: row.id, ownerId: row.ownerId })),
  );

  return rows.filter((row) => roleSatisfies(roles.get(row.id), "read"));
}

export async function getEntry(
  actor: Actor,
  entryId: string,
  options: { allowTrashed?: boolean } = {},
): Promise<DriveEntry> {
  return assertDrive(actor, "read", entryId, options);
}

const PAGE_SIZE_MAX = 500;
const TRASH_PAGE_SIZE = 100;
const RECENT_PAGE_SIZE = 200;
/** Fenêtre minimale scannée pour « Récents » : conserve la sémantique historique (200 lignes). */
const RECENT_SCAN_MIN = 200;

function clampPageSize(value: number | undefined, fallback: number): number {
  const requested = value === undefined || !Number.isFinite(value) ? fallback : Math.trunc(value);
  return Math.min(Math.max(requested, 1), PAGE_SIZE_MAX);
}

function clampOffset(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(Math.trunc(value), 0);
}

/**
 * Corbeille personnelle : éléments dont l'acteur est propriétaire (MVP).
 * Paginée (limit 1..500, défaut 100 ; offset ≥ 0) — ordre stable par date de mise
 * à la corbeille.
 */
export async function listTrash(
  actor: Actor,
  options: { limit?: number; offset?: number } = {},
): Promise<DriveEntry[]> {
  const limit = clampPageSize(options.limit, TRASH_PAGE_SIZE);
  const offset = clampOffset(options.offset);

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
    .orderBy(desc(driveFiles.trashedAt), desc(driveFiles.id))
    .limit(limit)
    .offset(offset);
}

/**
 * Éléments modifiés récemment (accessibles), du plus récent au plus ancien.
 * Paginée (limit 1..500, défaut 200) ; `before` borne la date de modification
 * (curseur) et la fenêtre scannée reste au moins 200 lignes, comme avant, pour
 * que la visibilité des premières pages soit identique.
 */
export async function listRecent(
  actor: Actor,
  options: { limit?: number; before?: Date } = {},
): Promise<DriveEntry[]> {
  const limit = clampPageSize(options.limit, RECENT_PAGE_SIZE);
  const conditions = [eq(driveFiles.orgId, actor.orgId), eq(driveFiles.status, "active")];
  if (options.before) conditions.push(lt(driveFiles.updatedAt, options.before));

  const rows = await db()
    .select()
    .from(driveFiles)
    .where(and(...conditions))
    .orderBy(desc(driveFiles.updatedAt), desc(driveFiles.id))
    .limit(Math.max(limit, RECENT_SCAN_MIN));

  const roles = await resolveRolesForEntries(
    actor,
    rows.map((row) => ({ id: row.id, ownerId: row.ownerId })),
  );

  return rows.filter((row) => roleSatisfies(roles.get(row.id), "read")).slice(0, limit);
}

/** Éléments partagés avec l'acteur (hors fichiers qu'il possède), avec son rôle. */
export async function listSharedWithMe(
  actor: Actor,
): Promise<{ entry: DriveEntry; role: GrantRole }[]> {
  const granted = await listGrantedResourceIds(actor, "file");
  if (granted.size === 0) return [];

  const rows = await db()
    .select()
    .from(driveFiles)
    .where(
      and(
        eq(driveFiles.orgId, actor.orgId),
        eq(driveFiles.status, "active"),
        inArray(driveFiles.id, [...granted.keys()]),
      ),
    )
    .orderBy(desc(driveFiles.updatedAt));

  const roles = await resolveRolesForEntries(
    actor,
    rows.map((row) => ({ id: row.id, ownerId: row.ownerId })),
  );

  return rows
    .filter((row) => row.ownerId !== actor.userId)
    .map((row) => ({
      entry: row,
      role: roles.get(row.id) ?? granted.get(row.id) ?? "viewer",
    }));
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

  const roles = await resolveRolesForEntries(
    actor,
    rows.map((row) => ({ id: row.id, ownerId: row.ownerId })),
  );

  return rows.filter((row) => roleSatisfies(roles.get(row.id), "read")).slice(0, limit);
}

/**
 * Vérifie le quota de stockage de l'organisation (réglage facultatif).
 * Consommation = somme des `size_bytes` des fichiers actifs (une seule requête SUM).
 */
async function assertStorageQuota(actor: Actor, incomingBytes: number): Promise<void> {
  const [settings] = await db()
    .select({ quotaBytes: coreSchema.orgSettings.storageQuotaBytes })
    .from(coreSchema.orgSettings)
    .where(eq(coreSchema.orgSettings.orgId, actor.orgId))
    .limit(1);

  const quotaBytes = settings?.quotaBytes ?? null;
  if (quotaBytes === null) return;

  const [usage] = await db()
    .select({ usedBytes: sql<number>`coalesce(sum(${driveFiles.sizeBytes}), 0)`.mapWith(Number) })
    .from(driveFiles)
    .where(and(eq(driveFiles.orgId, actor.orgId), eq(driveFiles.status, "active")));

  const usedBytes = usage?.usedBytes ?? 0;
  if (usedBytes + incomingBytes > quotaBytes) {
    throw new DriveError("quota", "Quota de stockage dépassé — contactez un administrateur.");
  }
}

export async function uploadFile(
  actor: Actor,
  input: { parentId?: string | null; name: string; contentType?: string; body: Buffer },
): Promise<{ entry: DriveEntry; version: DriveVersion }> {
  const name = assertValidName(input.name);
  const maxUploadBytes = getMaxUploadBytes();

  if (input.body.length === 0) throw new DriveError("validation", "Fichier vide.");
  if (input.body.length > maxUploadBytes) {
    throw new DriveError(
      "validation",
      `Fichier trop volumineux (maximum ${Math.floor(maxUploadBytes / (1024 * 1024))} Mo).`,
    );
  }

  const parentId = input.parentId ?? null;
  await assertWritableParent(actor, parentId);
  await assertStorageQuota(actor, input.body.length);

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

/** Remplace le contenu d'un fichier → nouvelle version (les anciennes suivent la rétention). */
export async function replaceContent(
  actor: Actor,
  fileId: string,
  input: { contentType?: string; body: Buffer },
): Promise<{ entry: DriveEntry; version: DriveVersion }> {
  const entry = await assertDrive(actor, "write", fileId);
  if (entry.kind !== "file") {
    throw new DriveError("validation", "Seul un fichier peut être remplacé.");
  }

  const maxUploadBytes = getMaxUploadBytes();
  if (input.body.length === 0) throw new DriveError("validation", "Fichier vide.");
  if (input.body.length > maxUploadBytes) {
    throw new DriveError("validation", "Fichier trop volumineux.");
  }

  const checksum = sha256(input.body);
  const key = orgKey(actor.orgId, randomUUID(), entry.name);
  await storage().put({ key, body: input.body, contentType: input.contentType });

  const result = await withTransaction(async (tx) => {
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

  // Rétention : purge au mieux des versions expirées (la version courante n'est
  // jamais supprimée), sans bloquer la réponse.
  void pruneVersions(actor, fileId).catch(() => undefined);

  return result;
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

/** Résumé d'une purge : lignes supprimées, blobs nettoyés et erreurs de nettoyage (best effort). */
export type PurgeSummary = {
  deletedEntries: number;
  deletedBlobs: number;
  blobErrors: { key: string; message: string }[];
};

/**
 * Purge définitive (corbeille uniquement) : collecte le sous-arbre entier via une
 * CTE récursive (`drive_files.parent_id` n'a pas de clé étrangère), supprime
 * versions, grants, liens et lignes dans une seule transaction, puis nettoie les
 * blobs après commit (best effort ; les erreurs sont retournées dans le résumé).
 */
export async function purge(actor: Actor, entryId: string): Promise<PurgeSummary> {
  const entry = await assertDrive(actor, "delete", entryId, { allowTrashed: true });
  if (entry.status !== "trashed") {
    throw new DriveError("validation", "Un élément doit être dans la corbeille pour être purgé.");
  }

  const { entryIds, keys } = await withTransaction(async (tx) => {
    const subtree = await tx.execute<{ id: string }>(sql`
      WITH RECURSIVE subtree AS (
        SELECT id FROM drive_files WHERE id = ${entryId} AND org_id = ${actor.orgId}
        UNION ALL
        SELECT f.id
        FROM drive_files f
        JOIN subtree s ON f.parent_id = s.id
        WHERE f.org_id = ${actor.orgId}
      )
      SELECT id FROM subtree
    `);
    const entryIds = subtree.rows.map((row) => row.id);
    if (entryIds.length === 0) return { entryIds, keys: [] as string[] };

    const fileRows = await tx
      .select({ storageKey: driveFiles.storageKey })
      .from(driveFiles)
      .where(and(eq(driveFiles.orgId, actor.orgId), inArray(driveFiles.id, entryIds)));
    const versionRows = await tx
      .select({ storageKey: driveFileVersions.storageKey })
      .from(driveFileVersions)
      .where(inArray(driveFileVersions.fileId, entryIds));

    const keys = new Set<string>();
    for (const row of fileRows) if (row.storageKey) keys.add(row.storageKey);
    for (const row of versionRows) keys.add(row.storageKey);

    // Ordre : versions → grants → liens → lignes. Les grants n'ont pas de clé
    // étrangère vers drive_files : sans suppression explicite ils resteraient orphelins.
    await tx.delete(driveFileVersions).where(inArray(driveFileVersions.fileId, entryIds));
    await tx
      .delete(coreSchema.resourceGrants)
      .where(
        and(
          eq(coreSchema.resourceGrants.resourceType, "file"),
          eq(coreSchema.resourceGrants.orgId, actor.orgId),
          inArray(coreSchema.resourceGrants.resourceId, entryIds),
        ),
      );
    await tx.delete(driveShareLinks).where(inArray(driveShareLinks.fileId, entryIds));
    await tx
      .delete(driveFiles)
      .where(and(eq(driveFiles.orgId, actor.orgId), inArray(driveFiles.id, entryIds)));

    return { entryIds, keys: [...keys] };
  });

  let deletedBlobs = 0;
  const blobErrors: { key: string; message: string }[] = [];
  for (const key of keys) {
    try {
      await storage().delete(key);
      deletedBlobs += 1;
    } catch (error) {
      blobErrors.push({ key, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return { deletedEntries: entryIds.length, deletedBlobs, blobErrors };
}

export async function listVersions(actor: Actor, fileId: string): Promise<DriveVersion[]> {
  await assertDrive(actor, "read", fileId);
  return db()
    .select()
    .from(driveFileVersions)
    .where(eq(driveFileVersions.fileId, fileId))
    .orderBy(desc(driveFileVersions.version));
}

/** Fenêtre de rétention des versions (jours) — réglage d'organisation, 90 par défaut. */
async function loadVersionRetentionDays(orgId: string): Promise<number> {
  const [settings] = await db()
    .select({ versionRetentionDays: coreSchema.orgSettings.versionRetentionDays })
    .from(coreSchema.orgSettings)
    .where(eq(coreSchema.orgSettings.orgId, orgId))
    .limit(1);

  return settings?.versionRetentionDays ?? DEFAULT_VERSION_RETENTION_DAYS;
}

/**
 * Rétention des versions : supprime les versions plus anciennes que la fenêtre
 * de rétention de l'organisation (`orgSettings.versionRetentionDays`, 90 jours
 * par défaut). La version courante — la plus récente, celle servie par
 * `driveFiles.storageKey` — n'est jamais supprimée, même expirée. Les blobs
 * orphelins sont nettoyés au mieux : une erreur de stockage ne fait pas échouer
 * la purge (les lignes, elles, sont déjà supprimées).
 *
 * Appelée au mieux après `replaceContent` ; exportée pour un usage manuel/admin.
 */
export async function pruneVersions(actor: Actor, entryId: string): Promise<{ removed: number }> {
  const entry = await assertDrive(actor, "write", entryId);
  if (entry.kind !== "file") return { removed: 0 };

  const retentionDays = await loadVersionRetentionDays(actor.orgId);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const versions = await db()
    .select({
      id: driveFileVersions.id,
      version: driveFileVersions.version,
      storageKey: driveFileVersions.storageKey,
      createdAt: driveFileVersions.createdAt,
    })
    .from(driveFileVersions)
    .where(eq(driveFileVersions.fileId, entryId));

  if (versions.length <= 1) return { removed: 0 };

  const latestVersion = Math.max(...versions.map((row) => row.version));
  // Garde le numéro le plus élevé et toute clé encore référencée par le fichier :
  // la version servie ne peut pas être purgée même si l'invariant est rompu.
  const stale = versions.filter(
    (row) =>
      row.version !== latestVersion &&
      row.storageKey !== entry.storageKey &&
      row.createdAt < cutoff,
  );
  if (stale.length === 0) return { removed: 0 };

  await db()
    .delete(driveFileVersions)
    .where(
      inArray(
        driveFileVersions.id,
        stale.map((row) => row.id),
      ),
    );

  await Promise.all(
    stale.map((row) =>
      storage()
        .delete(row.storageKey)
        .catch(() => undefined),
    ),
  );

  return { removed: stale.length };
}

/** Chaîne d'ancêtres (du plus haut au plus proche) — affichage du fil d'Ariane. */
export async function getAncestors(actor: Actor, entryId: string): Promise<DriveEntry[]> {
  await assertDrive(actor, "read", entryId);

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

/**
 * Un sujet utilisateur qui n'est pas membre de l'organisation de l'acteur est
 * « externe » (membre d'une autre organisation ou identifiant inconnu) : le
 * partage direct est alors soumis à `orgSettings.allowExternalSharing` (true
 * par défaut quand aucune ligne de réglages n'existe). Groupes et organisation
 * entière sont internes par construction et ne sont pas concernés.
 */
async function assertSharingSubjectAllowed(actor: Actor, subject: GrantSubject): Promise<void> {
  if (subject.kind !== "user") return;

  const [membership] = await db()
    .select({ userId: coreSchema.member.userId })
    .from(coreSchema.member)
    .where(
      and(
        eq(coreSchema.member.userId, subject.id),
        eq(coreSchema.member.organizationId, actor.orgId),
      ),
    )
    .limit(1);
  if (membership) return;

  const [settings] = await db()
    .select({ allowExternalSharing: coreSchema.orgSettings.allowExternalSharing })
    .from(coreSchema.orgSettings)
    .where(eq(coreSchema.orgSettings.orgId, actor.orgId))
    .limit(1);

  if (settings?.allowExternalSharing === false) {
    throw new DriveError("validation", "Le partage externe est désactivé pour cette organisation.");
  }
}

export async function shareEntry(
  actor: Actor,
  entryId: string,
  input: { subject: GrantSubject; role: GrantRole },
): Promise<ResourceGrantRow | null> {
  await assertDrive(actor, "share", entryId);
  await assertSharingSubjectAllowed(actor, input.subject);
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
  return revokeGrant({ type: "file", id: entryId, orgId: actor.orgId }, grantId);
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
