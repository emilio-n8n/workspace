import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TokenPrincipal } from "@workspace/auth";
import { deleteEvent } from "@workspace/calendar";
import { listMessages as listChatMessages } from "@workspace/chat";
import { getDb, schema } from "@workspace/database";
import { getDocumentByFileId, toPlainText } from "@workspace/docs";
import {
  createTextFile,
  deleteEntry,
  download,
  searchEntries,
  TEXT_FILE_MIME_TYPES,
} from "@workspace/drive";
import { getMessage } from "@workspace/mail";
import { createTask, listLists, listTasks, updateTask } from "@workspace/tasks";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { errorResult, requireScope, withAudit } from "./audit.ts";
import { registerSuiteTools } from "./tools-suite.ts";

/**
 * Outils MCP — mêmes services que l'application web, mêmes règles de
 * permission (ADR-0006). Aucun accès direct aux données.
 */

const MAX_TEXT_CHARS = 60_000;

function isTextLike(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return (
    mimeType.startsWith("text/") ||
    mimeType.includes("json") ||
    mimeType.includes("markdown") ||
    mimeType.includes("xml") ||
    mimeType === "application/x-yaml"
  );
}

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_TEXT_CHARS) return { text, truncated: false };
  return { text: `${text.slice(0, MAX_TEXT_CHARS)}\n[…tronqué]`, truncated: true };
}

export function registerTools(server: McpServer, principal: TokenPrincipal): void {
  const actor = { userId: principal.userId, orgId: principal.orgId };

  server.registerTool(
    "me.whoami",
    {
      title: "Identité du jeton",
      description:
        "Retourne l'utilisateur, l'organisation et les scopes du jeton MCP courant. Utile pour vérifier que l'agent utilise bien le jeton attendu.",
      inputSchema: {},
    },
    async () =>
      withAudit(principal, "me.whoami", async () => {
        const db = getDb();
        const [user] = await db
          .select({ name: schema.user.name, email: schema.user.email })
          .from(schema.user)
          .where(eq(schema.user.id, principal.userId))
          .limit(1);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  user: user ?? { name: null, email: null },
                  organizationId: principal.orgId,
                  scopes: principal.scopes,
                },
                null,
                2,
              ),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "audit.recent",
    {
      title: "Audit récent",
      description:
        "Derniers événements d'audit de l'organisation (succès, refus et erreurs, y compris ceux produits par les agents). Scope requis : audit:read.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ limit }) =>
      withAudit(principal, "audit.recent", async () => {
        requireScope(principal, "audit:read");

        const db = getDb();
        const [memberRow] = await db
          .select({ role: schema.member.role })
          .from(schema.member)
          .where(
            and(
              eq(schema.member.organizationId, principal.orgId),
              eq(schema.member.userId, principal.userId),
            ),
          )
          .limit(1);
        if (!memberRow || (memberRow.role !== "owner" && memberRow.role !== "admin")) {
          return errorResult("Accès à l'audit réservé aux administrateurs de l'organisation.");
        }
        const rows = await db
          .select({
            action: schema.auditEvents.action,
            result: schema.auditEvents.result,
            createdAt: schema.auditEvents.createdAt,
          })
          .from(schema.auditEvents)
          .where(eq(schema.auditEvents.orgId, principal.orgId))
          .orderBy(desc(schema.auditEvents.createdAt))
          .limit(limit ?? 10);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
                null,
                2,
              ),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "files.search",
    {
      title: "Rechercher des fichiers",
      description:
        "Recherche des fichiers par nom parmi ceux auxquels le propriétaire du jeton a accès (partages hérités compris). Scope requis : drive:read.",
      inputSchema: {
        query: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ query, limit }) =>
      withAudit(principal, "files.search", async () => {
        requireScope(principal, "drive:read");

        const results = await searchEntries(actor, { query, limit: limit ?? 25 });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                results.map((entry) => ({
                  id: entry.id,
                  name: entry.name,
                  mimeType: entry.mimeType,
                  sizeBytes: entry.sizeBytes,
                  updatedAt: entry.updatedAt.toISOString(),
                })),
                null,
                2,
              ),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "files.read",
    {
      title: "Lire un fichier texte",
      description:
        "Lit le contenu d'un fichier texte autorisé (text/*, JSON, Markdown, XML). Les formats binaires sont refusés pour l'instant. Scope requis : drive:read.",
      inputSchema: {
        fileId: z.string().uuid(),
      },
    },
    async ({ fileId }) =>
      withAudit(principal, "files.read", async () => {
        requireScope(principal, "drive:read");

        const { entry, body } = await download(actor, fileId);
        if (!isTextLike(entry.mimeType)) {
          return errorResult(
            `Type de fichier non lisible par un agent (${entry.mimeType ?? "inconnu"}).`,
          );
        }

        const { text, truncated } = truncate(body.toString("utf8"));
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  id: entry.id,
                  name: entry.name,
                  mimeType: entry.mimeType,
                  sizeBytes: entry.sizeBytes,
                  truncated,
                  text,
                },
                null,
                2,
              ),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "files.write",
    {
      title: "Créer un fichier texte",
      description:
        "Crée un fichier texte (text/plain par défaut, text/markdown ou application/json, 2 Mo max) à la racine ou dans le dossier `parentId`. Scope requis : drive:write.",
      inputSchema: {
        name: z.string().min(1).max(255),
        content: z.string().max(2_000_000),
        parentId: z.string().uuid().optional(),
        mimeType: z.enum(TEXT_FILE_MIME_TYPES).optional(),
      },
    },
    async ({ name, content, parentId, mimeType }) =>
      withAudit(principal, "files.write", async () => {
        requireScope(principal, "drive:write");

        const entry = await createTextFile(actor, { name, content, parentId, mimeType });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { id: entry.id, name: entry.name, sizeBytes: entry.sizeBytes },
                null,
                2,
              ),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "files.delete",
    {
      title: "Supprimer un fichier ou un dossier",
      description:
        'Met un élément à la corbeille (restaurable) ; avec `permanent: true`, purge définitive réservée au propriétaire et seulement si l\'élément est déjà dans la corbeille. Confirmation explicite obligatoire : `confirm: "SUPPRIMER"`. Scope requis : drive:write.',
      inputSchema: {
        fileId: z.string().uuid(),
        // Optionnel au niveau du schéma pour que l'absence de confirmation
        // arrive jusqu'au gestionnaire et reçoive un message explicite,
        // plutôt qu'un refus de validation générique du SDK.
        confirm: z.literal("SUPPRIMER").optional(),
        permanent: z.boolean().optional(),
      },
    },
    async ({ fileId, confirm, permanent }) =>
      withAudit(principal, "files.delete", async () => {
        requireScope(principal, "drive:write");
        if (confirm !== "SUPPRIMER") {
          return errorResult('Confirmation requise : passez confirm: "SUPPRIMER".');
        }

        const permanentDelete = permanent ?? false;
        await deleteEntry(actor, fileId, { permanent: permanentDelete });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ok: true, permanent: permanentDelete }, null, 2),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "docs.read",
    {
      title: "Lire un document",
      description:
        "Lit le texte d'un document Workspace (Docs) autorisé. Scope requis : docs:read.",
      inputSchema: {
        fileId: z.string().uuid(),
      },
    },
    async ({ fileId }) =>
      withAudit(principal, "docs.read", async () => {
        requireScope(principal, "docs:read");

        const { entry, document, content } = await getDocumentByFileId(actor, fileId);
        const { text, truncated } = truncate(toPlainText(content));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  fileId: entry.id,
                  title: document.title,
                  currentVersion: document.currentVersion,
                  truncated,
                  text,
                },
                null,
                2,
              ),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "tasks.lists",
    {
      title: "Lister les listes de tâches",
      description:
        "Liste les listes de tâches accessibles (personnelles et partagées) avec le rôle du propriétaire du jeton. Scope requis : tasks:read.",
      inputSchema: {},
    },
    async () =>
      withAudit(principal, "tasks.lists", async () => {
        requireScope(principal, "tasks:read");

        const rows = await listLists(actor);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                rows.map((row) => ({
                  id: row.list.id,
                  name: row.list.name,
                  role: row.role,
                })),
                null,
                2,
              ),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "tasks.list",
    {
      title: "Lister les tâches",
      description:
        "Liste les tâches accessibles — d'une liste donnée, ou de toutes les listes si `listId` est omis. Scope requis : tasks:read.",
      inputSchema: {
        listId: z.string().uuid().optional(),
      },
    },
    async ({ listId }) =>
      withAudit(principal, "tasks.list", async () => {
        requireScope(principal, "tasks:read");

        const lists = await listLists(actor);
        const targets = listId ? lists.filter((row) => row.list.id === listId) : lists;

        const output: {
          id: string;
          listId: string;
          listName: string;
          title: string;
          status: string;
          priority: string;
          dueAt: string | null;
        }[] = [];

        for (const target of targets) {
          const rows = await listTasks(actor, { listId: target.list.id });
          for (const task of rows) {
            output.push({
              id: task.id,
              listId: target.list.id,
              listName: target.list.name,
              title: task.title,
              status: task.status,
              priority: task.priority,
              dueAt: task.dueAt?.toISOString() ?? null,
            });
          }
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
        };
      }),
  );

  server.registerTool(
    "tasks.create",
    {
      title: "Créer une tâche",
      description:
        "Crée une tâche dans une liste accessible en écriture. Scope requis : tasks:write.",
      inputSchema: {
        listId: z.string().uuid(),
        title: z.string().min(1).max(500),
        priority: z.enum(["low", "medium", "high"]).optional(),
        dueAt: z.string().optional(),
      },
    },
    async ({ listId, title, priority, dueAt }) =>
      withAudit(principal, "tasks.create", async () => {
        requireScope(principal, "tasks:write");

        const task = await createTask(actor, { listId, title, priority, dueAt: dueAt ?? null });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  id: task.id,
                  listId: task.listId,
                  title: task.title,
                  status: task.status,
                  priority: task.priority,
                  dueAt: task.dueAt?.toISOString() ?? null,
                },
                null,
                2,
              ),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "tasks.update",
    {
      title: "Modifier une tâche",
      description:
        "Modifie le titre, le statut, la priorité ou l'échéance d'une tâche accessible en écriture (les champs omis restent inchangés, `dueAt: null` efface l'échéance). Scope requis : tasks:write.",
      inputSchema: {
        taskId: z.string().uuid(),
        title: z.string().min(1).max(500).optional(),
        status: z.enum(["todo", "in_progress", "done"]).optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        dueAt: z.string().nullable().optional(),
      },
    },
    async ({ taskId, title, status, priority, dueAt }) =>
      withAudit(principal, "tasks.update", async () => {
        requireScope(principal, "tasks:write");

        const task = await updateTask(actor, taskId, { title, status, priority, dueAt });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  id: task.id,
                  title: task.title,
                  status: task.status,
                  priority: task.priority,
                  dueAt: task.dueAt?.toISOString() ?? null,
                },
                null,
                2,
              ),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "tasks.complete",
    {
      title: "Terminer une tâche",
      description:
        "Marque une tâche accessible en écriture comme terminée (statut « done »). Scope requis : tasks:write.",
      inputSchema: {
        taskId: z.string().uuid(),
      },
    },
    async ({ taskId }) =>
      withAudit(principal, "tasks.complete", async () => {
        requireScope(principal, "tasks:write");

        const task = await updateTask(actor, taskId, { status: "done" });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ id: task.id, status: task.status }, null, 2),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "mail.read",
    {
      title: "Lire un message",
      description:
        "Lit un message de la boîte du propriétaire du jeton (corps tronqué au-delà de la limite d'affichage). Scope requis : mail:read.",
      inputSchema: {
        messageId: z.string().uuid(),
      },
    },
    async ({ messageId }) =>
      withAudit(principal, "mail.read", async () => {
        requireScope(principal, "mail:read");

        const message = await getMessage(actor, messageId);
        const { text, truncated } = truncate(message.body);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  id: message.id,
                  from: message.fromAddress,
                  to: message.toAddresses,
                  subject: message.subject,
                  body: text,
                  truncated,
                  starred: message.starred,
                  sendError: message.sendError,
                  createdAt: message.createdAt,
                },
                null,
                2,
              ),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "chat.read",
    {
      title: "Lire les messages d'une conversation",
      description:
        "Derniers messages d'une conversation dont le propriétaire du jeton est membre, du plus ancien au plus récent. Scope requis : chat:read.",
      inputSchema: {
        channelId: z.string().uuid(),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ channelId, limit }) =>
      withAudit(principal, "chat.read", async () => {
        requireScope(principal, "chat:read");

        const messages = await listChatMessages(actor, channelId, { limit: limit ?? 50 });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                messages.map((message) => ({
                  authorName: message.authorName,
                  body: message.body,
                  createdAt: message.createdAt,
                })),
                null,
                2,
              ),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "calendar.delete",
    {
      title: "Supprimer un événement",
      description:
        'Supprime définitivement un événement modifiable. Confirmation explicite obligatoire : `confirm: "SUPPRIMER"`. Scope requis : calendar:write.',
      inputSchema: {
        eventId: z.string().uuid(),
        // Optionnel au niveau du schéma pour que l'absence de confirmation
        // arrive jusqu'au gestionnaire et reçoive un message explicite,
        // plutôt qu'un refus de validation générique du SDK.
        confirm: z.literal("SUPPRIMER").optional(),
      },
    },
    async ({ eventId, confirm }) =>
      withAudit(principal, "calendar.delete", async () => {
        requireScope(principal, "calendar:write");
        if (confirm !== "SUPPRIMER") {
          return errorResult('Confirmation requise : passez confirm: "SUPPRIMER".');
        }

        await deleteEvent(actor, eventId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ ok: true }, null, 2) }],
        };
      }),
  );

  registerSuiteTools(server, principal);
}
