import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import process from "node:process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { authenticateApiToken } from "@workspace/auth";
import { loadDotEnv } from "@workspace/config";
import { createWorkspaceServer } from "./server.ts";

// Charge le .env du monorepo (usage développement local).
loadDotEnv(new URL("../../..", import.meta.url).pathname);

function log(message: string): void {
  // stderr uniquement : stdout est réservé au protocole MCP (stdio).
  console.error(`[mcp] ${message}`);
}

async function runStdio(): Promise<void> {
  const token = process.env.WORKSPACE_TOKEN;
  if (!token) {
    log("WORKSPACE_TOKEN manquant. Créez un jeton dans l'application (Agents & jetons).");
    process.exit(1);
  }

  const principal = await authenticateApiToken(token);
  if (!principal) {
    log("Jeton invalide, révoqué ou expiré.");
    process.exit(1);
  }

  const server = createWorkspaceServer(principal);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log(
    `prêt (stdio) — org ${principal.orgId}, ${principal.scopes.length} scope(s) : ${principal.scopes.join(", ")}`,
  );
}

async function handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const authorization = req.headers.authorization ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const principal = token ? await authenticateApiToken(token) : null;

  if (!principal) {
    res.statusCode = 401;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({ error: "unauthorized", message: "Jeton requis (Authorization: Bearer)." }),
    );
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("allow", "POST");
    res.end();
    return;
  }

  const server = createWorkspaceServer(principal);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  await transport.handleRequest(req, res);
}

async function runHttp(port: number): Promise<void> {
  const httpServer = createHttpServer((req, res) => {
    void handleHttpRequest(req, res).catch((error) => {
      console.error(`[mcp] erreur requête HTTP : ${String(error)}`);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "internal_error" }));
      }
    });
  });

  httpServer.listen(port, () => {
    log(`prêt (HTTP) sur http://localhost:${port} — Authorization: Bearer wsk_…`);
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const httpIndex = args.indexOf("--http");

  if (httpIndex === -1) {
    await runStdio();
    return;
  }

  const port = Number(args[httpIndex + 1] ?? "3333");
  await runHttp(Number.isFinite(port) && port > 0 ? port : 3333);
}

main().catch((error) => {
  log(`échec du démarrage : ${String(error)}`);
  process.exit(1);
});
