import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TokenPrincipal } from "@workspace/auth";
import { getDb, schema } from "@workspace/database";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireScope, withAudit } from "./audit.ts";

/**
 * Outils MCP v0 — volontairement minimaux et réels.
 * Les outils Drive/Docs (Phase 2) passeront par les mêmes services que le web ;
 * jamais d'accès direct aux données qui contournerait les permissions.
 */
export function registerTools(server: McpServer, principal: TokenPrincipal): void {
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
}
