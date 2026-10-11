import { getDb, withTransaction } from "@workspace/database";
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
import { desc, eq, sql } from "drizzle-orm";
import { escapeHtml, type PmNode, toHtml, toMarkdown } from "./export.ts";
import { type DocsDocument, type DocsVersion, docsDocuments, docsVersions } from "./schema.ts";

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

  return { entry, document };
}

export async function getDocumentByFileId(
  actor: Actor,
  fileId: string,
): Promise<{ entry: DriveEntry; document: DocsDocument; content: PmNode }> {
  const { entry, document } = await requireDocument(actor, fileId);
  const latest = await latestVersion(document.id);
  const content = (latest?.content as PmNode | undefined) ?? EMPTY_DOC;
  return { entry, document, content };
}

/** Sauvegarde : `replace-latest` (autosave) ou `append` (instantané explicite). */
export async function saveDocument(
  actor: Actor,
  fileId: string,
  input: { content: unknown; mode?: SaveMode },
): Promise<{ version: number; documentId: string }> {
  await requireDocument(actor, fileId);

  const role = await effectiveRole(actor, fileId);
  if (!roleSatisfies(role, "write")) {
    throw new DocsError("forbidden", "Permission insuffisante pour modifier ce document.");
  }

  const content = assertDocumentContent(input.content);
  const mode: SaveMode = input.mode ?? "replace-latest";

  const result = await withTransaction(async (tx) => {
    const [doc] = await tx
      .select()
      .from(docsDocuments)
      .where(eq(docsDocuments.fileId, fileId))
      .limit(1);
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
      await tx.insert(docsVersions).values({
        documentId: doc.id,
        version: bumped.version,
        content,
        createdBy: actor.userId,
      });
      return { version: bumped.version, documentId: doc.id };
    }

    // replace-latest : le contenu de la version courante est actualisé.
    // replace-latest : on conserve createdAt d'origine (seul le contenu vit).
    await tx
      .update(docsVersions)
      .set({ content, createdBy: actor.userId })
      .where(eq(docsVersions.id, latest.id));

    return { version: latest.version, documentId: doc.id };
  });

  // Met à jour « modifié récemment » côté Drive (best-effort, non bloquant).
  await touchEntry(actor, fileId).catch(() => undefined);

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

export async function renameDocument(
  actor: Actor,
  fileId: string,
  title: string,
): Promise<DriveEntry> {
  const clean = assertTitle(title);
  await requireDocument(actor, fileId);

  const entry = await driveRename(actor, fileId, clean);
  await db().update(docsDocuments).set({ title: clean }).where(eq(docsDocuments.fileId, fileId));

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
