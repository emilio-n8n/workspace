import { createServer } from "node:http";
import { getServerEnv, loadDotEnv } from "@workspace/config";
import { verifyCollabToken } from "@workspace/docs/collab-token";
import { type WebSocket, WebSocketServer } from "ws";
import { CLOSE_CAPACITY, CLOSE_INVALID_TOKEN } from "./protocol.ts";
import { CollabServer, closeConnection } from "./rooms.ts";

/**
 * Serveur de collaboration temps réel des Documents (Yjs).
 *
 * Sans état : chaque connexion présente un jeton signé par Docs
 * (`getCollabTokenFn`), vérifié ici avec le secret d'instance. Le serveur
 * relaie la synchronisation et la présence, et n'accorde l'écriture qu'aux
 * jetons `canWrite`. Le HTTP partage le port (santé sur `GET /health`).
 */

loadDotEnv();

const env = getServerEnv();
const secret = env.SESSION_SECRET;
if (!secret) {
  console.error("COLLAB: SESSION_SECRET est requis pour vérifier les jetons de collaboration.");
  process.exit(1);
}

const port = env.COLLAB_PORT ?? 3100;
const collab = new CollabServer();

const httpServer = createServer((request, response) => {
  const path = requestUrl(request.url, request.headers.host)?.pathname;
  if (request.method === "GET" && path === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", rooms: collab.roomCount }));
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not_found" }));
});

const wss = new WebSocketServer({ noServer: true });

/** Source commune : identifiant de document = UUID de fichier Drive. */
const UUID_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_PATTERN = new RegExp(`^${UUID_SOURCE}$`, "i");
/** Forme « client y-websocket » : le document est le nom de salle du chemin. */
const DOC_PATH_PATTERN = new RegExp(`^/(${UUID_SOURCE})$`, "i");

function requestUrl(requestUrl: string | undefined, host: string | undefined): URL | null {
  try {
    return new URL(requestUrl ?? "/", `http://${host ?? "localhost"}`);
  } catch {
    return null;
  }
}

/**
 * Le document vient de `?doc=` (intégration Docs) ou du chemin
 * (`/<fileId>`), forme naturelle d'un client y-websocket.
 */
function docIdFrom(url: URL): string {
  const fromQuery = url.searchParams.get("doc");
  if (fromQuery) return fromQuery;
  return DOC_PATH_PATTERN.exec(url.pathname)?.[1] ?? "";
}

httpServer.on("upgrade", (request, socket, head) => {
  const url = requestUrl(request.url, request.headers.host);
  const knownPath =
    url !== null &&
    (url.pathname === "/" || url.pathname === "/collab" || DOC_PATH_PATTERN.test(url.pathname));
  if (!url || !knownPath) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

wss.on("connection", (ws: WebSocket, request) => {
  const url = requestUrl(request.url, request.headers.host);
  const docId = url ? docIdFrom(url) : "";
  const token = url?.searchParams.get("token") ?? "";
  const payload = token && UUID_PATTERN.test(docId) ? verifyCollabToken(token, secret) : null;

  // Le jeton doit désigner *ce* document : pas de rejeu d'une salle à l'autre.
  if (!payload || payload.fileId !== docId) {
    closeConnection(ws, CLOSE_INVALID_TOKEN, "Jeton de collaboration invalide ou expiré");
    return;
  }

  if (!collab.accept(ws, docId, payload.canWrite)) {
    closeConnection(ws, CLOSE_CAPACITY, "Serveur de collaboration saturé");
  }
});

httpServer.on("error", (error) => {
  console.error("COLLAB: erreur du serveur HTTP", error);
  process.exit(1);
});

wss.on("error", (error) => {
  console.error("COLLAB: erreur du serveur WebSocket", error);
});

function shutdown(): void {
  for (const client of wss.clients) client.close(1001, "Arrêt du serveur");
  wss.close();
  httpServer.close(() => process.exit(0));
  // Filet de sécurité : des connexions récalcitrantes ne bloquent pas l'arrêt.
  setTimeout(() => process.exit(0), 1_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

httpServer.listen(port);
