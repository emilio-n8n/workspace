import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type TokenPrincipal, tokenHasScope, type WorkspaceScope } from "@workspace/auth";
import { getDb, schema } from "@workspace/database";

export class ToolDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolDeniedError";
  }
}

/** Refus par défaut : le scope demandé doit être présent sur le jeton. */
export function requireScope(principal: TokenPrincipal, scope: WorkspaceScope): void {
  if (!tokenHasScope(principal, scope)) {
    throw new ToolDeniedError(`Accès refusé : scope « ${scope} » requis.`);
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Journalise un événement d'audit. Une panne d'audit n'interrompt jamais
 * l'outil (elle est signalée sur stderr), mais elle est visible pour l'exploitant.
 */
async function writeAuditEvent(
  principal: TokenPrincipal,
  action: string,
  result: "success" | "denied" | "error",
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const db = getDb();
    await db.insert(schema.auditEvents).values({
      orgId: principal.orgId,
      actorUserId: principal.userId,
      actorTokenId: principal.tokenId,
      action: `mcp.${action}`,
      result,
      metadata: metadata ?? null,
    });
  } catch (error) {
    console.error(`[mcp] écriture d'audit impossible : ${errorText(error)}`);
  }
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Enveloppe obligatoire de chaque outil :
 * succès, refus (scope/permission) et erreurs sont journalisés ;
 * un refus ne fait jamais tomber le serveur.
 */
export function withAudit(
  principal: TokenPrincipal,
  toolName: string,
  handler: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  return handler()
    .then(async (result) => {
      await writeAuditEvent(principal, toolName, result.isError ? "denied" : "success");
      return result;
    })
    .catch(async (error) => {
      const denied = error instanceof ToolDeniedError;
      await writeAuditEvent(principal, toolName, denied ? "denied" : "error", {
        message: errorText(error),
      });
      return errorResult(errorText(error));
    });
}
