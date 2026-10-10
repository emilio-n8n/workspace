import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TokenPrincipal } from "@workspace/auth";
import { registerTools } from "./tools.ts";

export const SERVER_NAME = "workspace";

/**
 * Construit une instance MCP pour un principal déjà authentifié.
 * Aucun outil n'est accessible sans principal valide (refus par défaut).
 */
export function createWorkspaceServer(principal: TokenPrincipal): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: "0.1.0" });
  registerTools(server, principal);
  return server;
}
