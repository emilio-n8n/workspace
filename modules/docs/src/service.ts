import { recordAudit } from "@workspace/audit";
import { schema as coreSchema, getDb, withTransaction } from "@workspace/database";
import {
  createLinkedFile,
  type DriveEntry,
  rename as driveRename,
  effectiveRole,
  getEntry,
  listEntries,
  touchEntry,
} from "@workspace/drive";
import { type Actor, roleSatisfies } from "@workspace/permissions";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { escapeHtml, type PmNode, toHtml, toMarkdown } from "./export.ts";
import {
  type DocsComment,
  type DocsDocument,
  type DocsVersion,
  docsComments,
  docsDocuments,
  docsVersions,
} from "./schema.ts";

/** Type MIME du pointeur Drive d'un document Workspace. */
export const DOCS_MIME = "application/vnd.workspace.docs+json";

/** Document vide (JSON ProseMirror minimal valide). */
export const EMPTY_DOC: PmNode = { type: "doc", content: [{ type: "paragraph" }] };

export type DocsErrorCode = "not_found" | "forbidden" | "validation" | "conflict";

export class DocsError extends Error {
  readonly code: DocsErrorCode;
  constructor(code: DocsErrorCode, message: string) {
    super(message);
    this.name = "DocsError";
    this.code = code;
  }
}

/**
 * Mode de sauvegarde :
 * - `replace-latest` : autosave continu — remplace le contenu de la dernière
 *   version (pas de l'historique par frappe) ;
 * - `append` : instantané explicite (« Enregistrer une version »).
 */
export type SaveMode = "replace-latest" | "append";

const db = () => getDb();

/** Rétention des versions (jours) par défaut, si l'organisation n'a pas de réglage. */
const DEFAULT_VERSION_RETENTION_DAYS = 90;

function assertTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length < 1 || trimmed.length > 255) {
    throw new DocsError("validation", "Le titre doit contenir entre 1 et 255 caractères.");
  }
  const hasForbiddenChar = [...trimmed].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || char === "/" || char === "\\";
  });
  if (hasForbiddenChar) {
    throw new DocsError("validation", "Le titre contient des caractères interdits.");
  }
  return trimmed;
}

const ALLOWED_NODE_TYPES = new Set([
  "doc",
  "paragraph",
  "heading",
  "text",
  "bulletList",
  "orderedList",
  "listItem",
  "codeBlock",
  "blockquote",
  "horizontalRule",
  "hardBreak",
]);

const MAX_CONTENT_BYTES = 1_000_000;

function assertDocumentContent(content: unknown): PmNode {
  const candidate = content as PmNode;
  if (!candidate || typeof candidate !== "object" || candidate.type !== "doc") {
    throw new DocsError("validation", "Contenu de document invalide.");
  }
  const serialized = JSON.stringify(candidate);
  if (serialized.length > MAX_CONTENT_BYTES) {
    throw new DocsError("validation", "Document trop volumineux (1 Mo maximum).");
  }
  const walk = (node: PmNode, depth: number): void => {
    if (depth > 100) {
      throw new DocsError("validation", "Document trop profondément imbriqué.");
    }
    if (typeof node.type !== "string" || !ALLOWED_NODE_TYPES.has(node.type)) {
      throw new DocsError("validation", "Contenu de document invalide.");
    }
    for (const child of node.content ?? []) walk(child, depth + 1);
  };
  walk(candidate, 0);
  return candidate;
}

/** Vérifie l'accès en lecture via Drive puis retourne la ligne `docs_documents`. */
async function requireDocument(
  actor: Actor,
  fileId: string,
): Promise<{ entry: DriveEntry; document: DocsDocument }> {
  const entry = await getEntry(actor, fileId);
  if (entry.mimeType !== DOCS_MIME) {
    throw new DocsError("not_found", "Document introuvable.");
  }

  const [document] = await db()
    .select()
    .from(docsDocuments)
    .where(eq(docsDocuments.fileId, fileId))
    .limit(1);

  if (!document || document.orgId !== actor.orgId) {
    throw new DocsError("not_found", "Document introuvable.");
  }

  return { entry, document };
}

async function latestVersion(documentId: string): Promise<DocsVersion | null> {
  const [latest] = await db()
    .select()
    .from(docsVersions)
    .where(eq(docsVersions.documentId, documentId))
    .orderBy(desc(docsVersions.version))
    .limit(1);
  return latest ?? null;
}

// ---------------------------------------------------------------------------
// Cycle de vie
// ---------------------------------------------------------------------------

// Mutations notables uniquement : l'autosave (`saveDocument`), l'export et la
// liste des versions ne sont pas journalisés — un événement par frappe
// noierait le journal d'audit.

export async function createDocument(
  actor: Actor,
  input: { parentFolderId?: string | null; title: string },
): Promise<{ entry: DriveEntry; document: DocsDocument }> {
  const title = assertTitle(input.title);

  const entry = await createLinkedFile(actor, {
    parentId: input.parentFolderId ?? null,
    name: title,
    mimeType: DOCS_MIME,
  });

  const document = await withTransaction(async (tx) => {
    const [doc] = await tx
      .insert(docsDocuments)
      .values({ orgId: actor.orgId, fileId: entry.id, title, createdBy: actor.userId })
      .returning();
    if (!doc) throw new DocsError("conflict", "Création du document impossible.");

    await tx.insert(docsVersions).values({
      documentId: doc.id,
      version: 1,
      content: EMPTY_DOC,
      createdBy: actor.userId,
    });

    return doc;
  });

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "docs.document.create",
    resourceType: "document",
    resourceId: entry.id,
    result: "success",
  });

  return { entry, document };
}

export async function getDocumentByFileId(
  actor: Actor,
  fileId: string,
): Promise<{ entry: DriveEntry; document: DocsDocument; content: PmNode; revision: string }> {
  const { entry, document } = await requireDocument(actor, fileId);
  const latest = await latestVersion(document.id);
  const content = (latest?.content as PmNode | undefined) ?? EMPTY_DOC;
  // Jeton de révision : l'horodatage de la version courante. Les clients le
  // renvoient en `baseUpdatedAt` pour que l'autosave ne puisse pas écraser
  // silencieusement une sauvegarde concurrente.
  const revision = (latest?.createdAt ?? document.updatedAt).toISOString();
  return { entry, document, content, revision };
}

/**
 * Sauvegarde : `replace-latest` (autosave) ou `append` (instantané explicite).
 *
 * Verrouillage optimiste : le client fournit `baseUpdatedAt` (la révision
 * reçue au chargement ou à la dernière sauvegarde). Si la version courante a
 * changé entre-temps, la sauvegarde `replace-latest` est refusée en conflit —
 * deux onglets ouverts ne peuvent plus s'écraser en silence. Sans
 * `baseUpdatedAt`, le comportement historique est conservé (aucune
 * vérification) ; `append` crée toujours une nouvelle version, sans base.
 */
export async function saveDocument(
  actor: Actor,
  fileId: string,
  input: { content: unknown; mode?: SaveMode; baseUpdatedAt?: string },
): Promise<{ version: number; documentId: string; updatedAt: string }> {
  await requireDocument(actor, fileId);

  const role = await effectiveRole(actor, fileId);
  if (!roleSatisfies(role, "write")) {
    throw new DocsError("forbidden", "Permission insuffisante pour modifier ce document.");
  }

  const content = assertDocumentContent(input.content);
  const mode: SaveMode = input.mode ?? "replace-latest";

  const result = await withTransaction(async (tx) => {
    // Verrou de la ligne document (SELECT … FOR UPDATE) : les sauvegardes
    // concurrentes d'un même document sont sérialisées, ce qui rend la
    // vérification de révision ci-dessous atomique (pas de double
    // « replace-latest » accepté sur la même base).
    const [doc] = await tx
      .select()
      .from(docsDocuments)
      .where(eq(docsDocuments.fileId, fileId))
      .limit(1)
      .for("update");
    if (!doc || doc.orgId !== actor.orgId) {
      throw new DocsError("not_found", "Document introuvable.");
    }

    const [latest] = await tx
      .select()
      .from(docsVersions)
      .where(eq(docsVersions.documentId, doc.id))
      .orderBy(desc(docsVersions.version))
      .limit(1);

    if (!latest) {
      throw new DocsError("not_found", "Document sans contenu.");
    }

    if (mode === "append") {
      // Incrément atomique : deux instantanés concurrents ne peuvent pas
      // produire la même version (la ligne est verrouillée par l'UPDATE).
      const [bumped] = await tx
        .update(docsDocuments)
        .set({ currentVersion: sql`${docsDocuments.currentVersion} + 1` })
        .where(eq(docsDocuments.id, doc.id))
        .returning({ version: docsDocuments.currentVersion });
      if (!bumped) throw new DocsError("conflict", "Enregistrement concurrent impossible.");
      const [snapshot] = await tx
        .insert(docsVersions)
        .values({
          documentId: doc.id,
          version: bumped.version,
          content,
          createdBy: actor.userId,
        })
        .returning({ createdAt: docsVersions.createdAt });
      if (!snapshot) throw new DocsError("conflict", "Enregistrement concurrent impossible.");
      return {
        version: bumped.version,
        documentId: doc.id,
        updatedAt: snapshot.createdAt.toISOString(),
      };
    }

    // Autosave optimiste : le client s'appuie sur une révision périmée ⇒ une
    // autre session a modifié le document entre-temps.
    if (
      input.baseUpdatedAt !== undefined &&
      latest.createdAt.toISOString() !== input.baseUpdatedAt
    ) {
      throw new DocsError("conflict", "Le document a été modifié ailleurs — rechargez la page.");
    }

    // replace-latest : le contenu de la version courante est actualisé et son
    // createdAt devient le jeton de révision. Il avance strictement, même si
    // deux sauvegardes tombent dans la même milliseconde.
    const revision = new Date(Math.max(Date.now(), latest.createdAt.getTime() + 1));
    const [updated] = await tx
      .update(docsVersions)
      .set({ content, createdBy: actor.userId, createdAt: revision })
      .where(eq(docsVersions.id, latest.id))
      .returning({ createdAt: docsVersions.createdAt });
    if (!updated) throw new DocsError("conflict", "Enregistrement concurrent impossible.");

    return {
      version: latest.version,
      documentId: doc.id,
      updatedAt: updated.createdAt.toISOString(),
    };
  });

  // Met à jour « modifié récemment » côté Drive (best-effort, non bloquant).
  await touchEntry(actor, fileId).catch(() => undefined);

  // Rétention : purge au mieux des versions expirées (la version courante n'est
  // jamais supprimée), sans bloquer la réponse.
  void pruneDocumentVersions(actor, fileId).catch(() => undefined);

  return result;
}

export async function listDocumentVersions(actor: Actor, fileId: string): Promise<DocsVersion[]> {
  const { document } = await requireDocument(actor, fileId);
  return db()
    .select()
    .from(docsVersions)
    .where(eq(docsVersions.documentId, document.id))
    .orderBy(desc(docsVersions.version));
}

/**
 * Restaure une version : son contenu est recopié dans une NOUVELLE version
 * (sémantique append) — l'historique n'est jamais réécrit, une restauration
 * est donc elle-même réversible et visible dans l'historique. Retourne le
 * numéro de la version créée.
 */
export async function restoreDocumentVersion(
  actor: Actor,
  fileId: string,
  version: number,
): Promise<{ version: number }> {
  await requireDocument(actor, fileId);

  const role = await effectiveRole(actor, fileId);
  if (!roleSatisfies(role, "write")) {
    throw new DocsError("forbidden", "Permission insuffisante pour restaurer ce document.");
  }

  const restored = await withTransaction(async (tx) => {
    // Même verrou que saveDocument : les restaurations et sauvegardes
    // concurrentes sont sérialisées sur la ligne document.
    const [doc] = await tx
      .select()
      .from(docsDocuments)
      .where(eq(docsDocuments.fileId, fileId))
      .limit(1)
      .for("update");
    if (!doc || doc.orgId !== actor.orgId) {
      throw new DocsError("not_found", "Document introuvable.");
    }

    const [target] = await tx
      .select({ content: docsVersions.content })
      .from(docsVersions)
      .where(and(eq(docsVersions.documentId, doc.id), eq(docsVersions.version, version)))
      .limit(1);
    if (!target) {
      throw new DocsError("not_found", "Version introuvable.");
    }

    // Incrément atomique identique à l'append de saveDocument : deux
    // restaurations concurrentes ne peuvent pas produire la même version.
    const [bumped] = await tx
      .update(docsDocuments)
      .set({ currentVersion: sql`${docsDocuments.currentVersion} + 1` })
      .where(eq(docsDocuments.id, doc.id))
      .returning({ version: docsDocuments.currentVersion });
    if (!bumped) throw new DocsError("conflict", "Restauration concurrente impossible.");

    await tx.insert(docsVersions).values({
      documentId: doc.id,
      version: bumped.version,
      content: target.content as PmNode,
      createdBy: actor.userId,
    });

    return bumped.version;
  });

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "docs.document.restore",
    resourceType: "document",
    resourceId: fileId,
    result: "success",
    metadata: { restoredFrom: version },
  });

  // Met à jour « modifié récemment » côté Drive (best-effort, non bloquant).
  await touchEntry(actor, fileId).catch(() => undefined);

  return { version: restored };
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
 * par défaut). La version la plus récente et celle référencée comme courante
 * (`docsDocuments.currentVersion`) sont toujours conservées : au moins une
 * version subsiste après purge.
 *
 * Appelée au mieux après `saveDocument` ; exportée pour un usage manuel/admin.
 */
export async function pruneDocumentVersions(
  actor: Actor,
  fileId: string,
): Promise<{ removed: number }> {
  const { document } = await requireDocument(actor, fileId);

  const role = await effectiveRole(actor, fileId);
  if (!roleSatisfies(role, "write")) {
    throw new DocsError("forbidden", "Permission insuffisante pour modifier ce document.");
  }

  const retentionDays = await loadVersionRetentionDays(actor.orgId);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const versions = await db()
    .select({
      id: docsVersions.id,
      version: docsVersions.version,
      createdAt: docsVersions.createdAt,
    })
    .from(docsVersions)
    .where(eq(docsVersions.documentId, document.id));

  if (versions.length <= 1) return { removed: 0 };

  const latestVersion = Math.max(...versions.map((row) => row.version));
  const kept = new Set([latestVersion, document.currentVersion]);
  const stale = versions.filter((row) => !kept.has(row.version) && row.createdAt < cutoff);
  if (stale.length === 0) return { removed: 0 };

  await db()
    .delete(docsVersions)
    .where(
      inArray(
        docsVersions.id,
        stale.map((row) => row.id),
      ),
    );

  return { removed: stale.length };
}

export async function renameDocument(
  actor: Actor,
  fileId: string,
  title: string,
): Promise<DriveEntry> {
  const clean = assertTitle(title);
  await requireDocument(actor, fileId);

  const entry = await driveRename(actor, fileId, clean);
  await db().update(docsDocuments).set({ title: clean }).where(eq(docsDocuments.fileId, fileId));

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "docs.document.rename",
    resourceType: "document",
    resourceId: fileId,
    result: "success",
  });

  return entry;
}

/** Documents visibles d'un dossier (Drive reste la source de l'arborescence). */
export async function listDocuments(
  actor: Actor,
  input: { parentFolderId?: string | null } = {},
): Promise<DriveEntry[]> {
  const entries = await listEntries(actor, { parentId: input.parentFolderId ?? null });
  return entries.filter((entry) => entry.kind === "file" && entry.mimeType === DOCS_MIME);
}

// ---------------------------------------------------------------------------
// Commentaires
// ---------------------------------------------------------------------------

/** Commentaire d'un document, enrichi du nom de son auteur (pour l'UI). */
export type CommentView = {
  id: string;
  body: string;
  quote: string | null;
  authorId: string;
  authorName: string;
  /** Horodatage ISO de résolution, `null` tant que le fil est ouvert. */
  resolvedAt: string | null;
  createdAt: string;
};

const MAX_COMMENT_BODY = 4000;
const MAX_COMMENT_QUOTE = 500;

function assertCommentBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_COMMENT_BODY) {
    throw new DocsError("validation", "Le commentaire doit contenir entre 1 et 4000 caractères.");
  }
  return trimmed;
}

function assertCommentQuote(quote: string | null | undefined): string | null {
  if (quote === null || quote === undefined) return null;
  const trimmed = quote.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_COMMENT_QUOTE) {
    throw new DocsError("validation", "L'extrait cité ne peut pas dépasser 500 caractères.");
  }
  return trimmed;
}

async function commentAuthorName(userId: string): Promise<string> {
  const [author] = await db()
    .select({ name: coreSchema.user.name })
    .from(coreSchema.user)
    .where(eq(coreSchema.user.id, userId))
    .limit(1);
  return author?.name ?? "";
}

function toCommentView(row: DocsComment, authorName: string): CommentView {
  return {
    id: row.id,
    body: row.body,
    quote: row.quote,
    authorId: row.authorId,
    authorName,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Charge un commentaire du document (isolation par document), sinon `not_found`. */
async function requireComment(documentId: string, commentId: string): Promise<DocsComment> {
  const [comment] = await db()
    .select()
    .from(docsComments)
    .where(and(eq(docsComments.id, commentId), eq(docsComments.documentId, documentId)))
    .limit(1);
  if (!comment) throw new DocsError("not_found", "Commentaire introuvable.");
  return comment;
}

/**
 * Ajoute un commentaire. Réservé aux rôles « commenter » et supérieurs
 * (`roleSatisfies(role, "comment")`) : un viewer lit mais ne commente pas.
 */
export async function addComment(
  actor: Actor,
  fileId: string,
  input: { body: string; quote?: string | null },
): Promise<CommentView> {
  const { document } = await requireDocument(actor, fileId);

  const role = await effectiveRole(actor, fileId);
  if (!roleSatisfies(role, "comment")) {
    throw new DocsError("forbidden", "Permission insuffisante pour commenter ce document.");
  }

  const body = assertCommentBody(input.body);
  const quote = assertCommentQuote(input.quote);

  const [created] = await db()
    .insert(docsComments)
    .values({ documentId: document.id, authorId: actor.userId, body, quote })
    .returning();
  if (!created) throw new DocsError("conflict", "Ajout du commentaire impossible.");

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "docs.comment.add",
    resourceType: "document",
    resourceId: fileId,
    result: "success",
    metadata: { commentId: created.id },
  });

  return toCommentView(created, await commentAuthorName(actor.userId));
}

/** Commentaires d'un document, du plus ancien au plus récent (lecture seule). */
export async function listComments(actor: Actor, fileId: string): Promise<CommentView[]> {
  const { document } = await requireDocument(actor, fileId);

  const role = await effectiveRole(actor, fileId);
  if (!roleSatisfies(role, "read")) {
    throw new DocsError("forbidden", "Permission insuffisante pour consulter les commentaires.");
  }

  const rows = await db()
    .select({
      id: docsComments.id,
      body: docsComments.body,
      quote: docsComments.quote,
      authorId: docsComments.authorId,
      authorName: coreSchema.user.name,
      resolvedAt: docsComments.resolvedAt,
      createdAt: docsComments.createdAt,
    })
    .from(docsComments)
    .innerJoin(coreSchema.user, eq(coreSchema.user.id, docsComments.authorId))
    .where(eq(docsComments.documentId, document.id))
    .orderBy(asc(docsComments.createdAt), asc(docsComments.id));

  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    quote: row.quote,
    authorId: row.authorId,
    authorName: row.authorName,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Résout (`true`) ou rouvre (`false`) un commentaire — commenter et supérieurs. */
export async function resolveComment(
  actor: Actor,
  fileId: string,
  commentId: string,
  resolved: boolean,
): Promise<CommentView> {
  const { document } = await requireDocument(actor, fileId);

  const role = await effectiveRole(actor, fileId);
  if (!roleSatisfies(role, "comment")) {
    throw new DocsError("forbidden", "Permission insuffisante pour résoudre ce commentaire.");
  }

  const [updated] = await db()
    .update(docsComments)
    .set({ resolvedAt: resolved ? new Date() : null })
    .where(and(eq(docsComments.id, commentId), eq(docsComments.documentId, document.id)))
    .returning();
  if (!updated) throw new DocsError("not_found", "Commentaire introuvable.");

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: resolved ? "docs.comment.resolve" : "docs.comment.reopen",
    resourceType: "document",
    resourceId: fileId,
    result: "success",
  });

  return toCommentView(updated, await commentAuthorName(updated.authorId));
}

/** Supprime un commentaire : son auteur, ou le propriétaire effectif du document. */
export async function deleteComment(
  actor: Actor,
  fileId: string,
  commentId: string,
): Promise<void> {
  const { document } = await requireDocument(actor, fileId);
  const comment = await requireComment(document.id, commentId);

  const role = await effectiveRole(actor, fileId);
  if (comment.authorId !== actor.userId && !roleSatisfies(role, "manage")) {
    throw new DocsError(
      "forbidden",
      "Seul l'auteur ou le propriétaire du document peut supprimer ce commentaire.",
    );
  }

  await db().delete(docsComments).where(eq(docsComments.id, comment.id));

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "docs.comment.delete",
    resourceType: "document",
    resourceId: fileId,
    result: "success",
  });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type ExportFormat = "md" | "html";

export async function exportDocument(
  actor: Actor,
  fileId: string,
  format: ExportFormat,
): Promise<{ name: string; contentType: string; body: string }> {
  const { document, content } = await getDocumentByFileId(actor, fileId);

  if (format === "md") {
    return {
      name: `${document.title}.md`,
      contentType: "text/markdown; charset=utf-8",
      body: toMarkdown(content),
    };
  }

  return {
    name: `${document.title}.html`,
    contentType: "text/html; charset=utf-8",
    body: `<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8" />\n<title>${escapeHtml(document.title)}</title>\n</head>\n<body>\n${toHtml(content)}\n</body>\n</html>\n`,
  };
}
