import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TokenPrincipal } from "@workspace/auth";
import { createDocument, searchDocumentsText, writeDocumentText } from "@workspace/docs";
import {
  createFolder,
  download,
  moveEntries,
  rename,
  replaceContent,
  searchEntries,
} from "@workspace/drive";
import { z } from "zod";
import { errorResult, requireScope, withAudit } from "./audit.ts";

/**
 * Outils MCP d'écriture Docs/Drive et recherche plein texte — mêmes services
 * et mêmes règles de permission que l'application web (ADR-0006). Chaque
 * écriture Docs crée une version : l'historique permet de revenir en arrière.
 */

const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

/** Types texte remplaçables par un agent (les binaires restent hors de portée). */
function isTextLike(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return (
    mimeType.startsWith("text/") ||
    mimeType.includes("json") ||
    mimeType.includes("markdown") ||
    mimeType.includes("xml")
  );
}

export function registerWriteTools(server: McpServer, principal: TokenPrincipal): void {
  const actor = { userId: principal.userId, orgId: principal.orgId };

  server.registerTool(
    "docs.create",
    {
      title: "Créer un document",
      description:
        "Crée un document Workspace (Docs) à la racine du Drive ou dans `parentFolderId`, avec un contenu initial facultatif en texte / Markdown léger (`#` titres, `- ` puces). Scope requis : docs:write.",
      inputSchema: {
        title: z.string().min(1).max(255),
        text: z.string().max(500_000).optional(),
        parentFolderId: z.string().uuid().optional(),
      },
    },
    async ({ title, text, parentFolderId }) =>
      withAudit(principal, "docs.create", async () => {
        requireScope(principal, "docs:write");
        const { entry, document } = await createDocument(actor, {
          title,
          parentFolderId: parentFolderId ?? null,
        });
        let version = document.currentVersion;
        if (text?.trim()) {
          version = (await writeDocumentText(actor, entry.id, { text, mode: "replace" })).version;
        }
        return json({ fileId: entry.id, title: document.title, version });
      }),
  );

  server.registerTool(
    "docs.write",
    {
      title: "Écrire dans un document",
      description:
        'Ajoute du texte à la fin d\'un document (`mode: "append"`, par défaut) ou remplace tout son contenu (`mode: "replace"`). Texte / Markdown léger. Une nouvelle version est créée à chaque écriture (restaurable avec docs.restore_version). Scope requis : docs:write.',
      inputSchema: {
        fileId: z.string().uuid(),
        text: z.string().min(1).max(500_000),
        mode: z.enum(["append", "replace"]).optional(),
      },
    },
    async ({ fileId, text, mode }) =>
      withAudit(principal, "docs.write", async () => {
        requireScope(principal, "docs:write");
        const result = await writeDocumentText(actor, fileId, { text, mode: mode ?? "append" });
        return json({ fileId, version: result.version, updatedAt: result.updatedAt });
      }),
  );

  server.registerTool(
    "files.update",
    {
      title: "Remplacer le contenu d'un fichier texte",
      description:
        "Remplace le contenu d'un fichier texte existant (nouvelle version Drive, l'ancienne reste dans l'historique). Les fichiers binaires et les documents Docs sont refusés (utilisez docs.write). Scope requis : drive:write.",
      inputSchema: {
        fileId: z.string().uuid(),
        content: z.string().max(2_000_000),
      },
    },
    async ({ fileId, content }) =>
      withAudit(principal, "files.update", async () => {
        requireScope(principal, "drive:write");
        const { entry } = await download(actor, fileId);
        if (!isTextLike(entry.mimeType)) {
          return errorResult(
            `Seuls les fichiers texte sont modifiables par un agent (${entry.mimeType ?? "type inconnu"}).`,
          );
        }
        const { entry: updated, version } = await replaceContent(actor, fileId, {
          contentType: entry.mimeType ?? "text/plain",
          body: Buffer.from(content, "utf8"),
        });
        return json({
          id: updated.id,
          name: updated.name,
          sizeBytes: updated.sizeBytes,
          version: version.version,
        });
      }),
  );

  server.registerTool(
    "drive.create_folder",
    {
      title: "Créer un dossier",
      description:
        "Crée un dossier à la racine du Drive ou dans `parentId`. Scope requis : drive:write.",
      inputSchema: {
        name: z.string().min(1).max(255),
        parentId: z.string().uuid().optional(),
      },
    },
    async ({ name, parentId }) =>
      withAudit(principal, "drive.create_folder", async () => {
        requireScope(principal, "drive:write");
        const folder = await createFolder(actor, { name, parentId: parentId ?? null });
        return json({ id: folder.id, name: folder.name, parentId: folder.parentId });
      }),
  );

  server.registerTool(
    "drive.rename",
    {
      title: "Renommer un fichier ou un dossier",
      description: "Renomme un élément du Drive. Scope requis : drive:write.",
      inputSchema: {
        entryId: z.string().uuid(),
        name: z.string().min(1).max(255),
      },
    },
    async ({ entryId, name }) =>
      withAudit(principal, "drive.rename", async () => {
        requireScope(principal, "drive:write");
        const entry = await rename(actor, entryId, name);
        return json({ id: entry.id, name: entry.name });
      }),
  );

  server.registerTool(
    "drive.move",
    {
      title: "Déplacer des éléments",
      description:
        "Déplace un ou plusieurs éléments vers le dossier `targetParentId` (absent : racine). Renvoie les éléments déplacés et les échecs un par un. Scope requis : drive:write.",
      inputSchema: {
        entryIds: z.array(z.string().uuid()).min(1).max(100),
        targetParentId: z.string().uuid().optional(),
      },
    },
    async ({ entryIds, targetParentId }) =>
      withAudit(principal, "drive.move", async () => {
        requireScope(principal, "drive:write");
        const result = await moveEntries(actor, {
          entryIds,
          targetParentId: targetParentId ?? null,
        });
        return json(result);
      }),
  );

  server.registerTool(
    "search.fulltext",
    {
      title: "Recherche plein texte",
      description:
        "Recherche dans le CONTENU des documents Docs (extrait autour de l'occurrence) et dans les noms de fichiers du Drive, parmi les éléments accessibles au propriétaire du jeton. Scopes : docs:read pour les documents, drive:read pour les fichiers (au moins l'un des deux).",
      inputSchema: {
        query: z.string().min(2).max(200),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ query, limit }) =>
      withAudit(principal, "search.fulltext", async () => {
        const canDocs = principal.scopes.includes("docs:read");
        const canDrive = principal.scopes.includes("drive:read");
        if (!canDocs && !canDrive) requireScope(principal, "docs:read");
        const max = limit ?? 20;
        const documents = canDocs ? await searchDocumentsText(actor, { query, limit: max }) : [];
        const files = canDrive
          ? (await searchEntries(actor, { query, limit: max })).map((entry) => ({
              id: entry.id,
              name: entry.name,
              kind: entry.kind,
              mimeType: entry.mimeType,
              updatedAt: entry.updatedAt.toISOString(),
            }))
          : [];
        return json({ documents, files });
      }),
  );
}
