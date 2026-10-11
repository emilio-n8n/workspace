import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TokenPrincipal } from "@workspace/auth";
import { getDb, schema } from "@workspace/database";
import { getDocumentByFileId, toPlainText } from "@workspace/docs";
import { download, searchEntries } from "@workspace/drive";
import { createTask, listLists, listTasks } from "@workspace/tasks";
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

  registerSuiteTools(server, principal);
}
