import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { type RawData, WebSocket } from "ws";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import {
  CLOSE_READ_ONLY,
  MAX_CONNS_PER_ROOM,
  MAX_READONLY_VIOLATIONS,
  MAX_ROOMS,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  PING_TIMEOUT_MS,
  shouldAcceptUpdate,
} from "./protocol.ts";

/** État serveur d'une connexion rattachée à une salle. */
type ConnectionState = {
  /** Droit d'écriture issu du jeton : un lecteur ne modifie jamais le document. */
  canWrite: boolean;
  /** Messages d'écriture refusés depuis le début de la connexion. */
  violations: number;
  /** Identifiants de présence publiés par cette connexion (nettoyés à sa fermeture). */
  awarenessIds: Set<number>;
  /** Détection des connexions mortes : aucun pong reçu depuis le dernier ping. */
  pingTimer: NodeJS.Timeout | null;
  pongReceived: boolean;
};

type Room = {
  id: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  conns: Map<WebSocket, ConnectionState>;
};

/**
 * Salles en mémoire, sans persistance : le serveur ne fait que relayer la
 * synchronisation Yjs et la présence entre clients. Une salle disparaît avec
 * sa dernière connexion.
 */
export class CollabServer {
  private readonly rooms = new Map<string, Room>();

  /** Nombre de salles actives (exposé par `GET /health`). */
  get roomCount(): number {
    return this.rooms.size;
  }

  /**
   * Rattache une connexion déjà authentifiée à la salle `docId`.
   * Retourne `false` si le serveur ou la salle est saturé — l'appelant ferme
   * alors la connexion avec le code 1013.
   */
  accept(ws: WebSocket, docId: string, canWrite: boolean): boolean {
    let room = this.rooms.get(docId);
    if (!room) {
      if (this.rooms.size >= MAX_ROOMS) return false;
      room = createRoom(docId);
      this.rooms.set(docId, room);
    }
    if (room.conns.size >= MAX_CONNS_PER_ROOM) return false;

    const active = room;
    const state: ConnectionState = {
      canWrite,
      violations: 0,
      awarenessIds: new Set(),
      pongReceived: true,
      pingTimer: null,
    };
    active.conns.set(ws, state);

    ws.on("message", (data: RawData) => this.onMessage(active, ws, state, data));
    ws.on("pong", () => {
      state.pongReceived = true;
    });
    ws.on("close", () => this.detach(active, ws));
    ws.on("error", () => this.detach(active, ws));

    state.pingTimer = setInterval(() => {
      if (!state.pongReceived) {
        clearInterval(state.pingTimer ?? undefined);
        closeConnection(ws, 1001, "Connexion inactive");
        return;
      }
      state.pongReceived = false;
      try {
        ws.ping();
      } catch {
        clearInterval(state.pingTimer ?? undefined);
        closeConnection(ws, 1001, "Connexion inactive");
      }
    }, PING_TIMEOUT_MS);

    // Le serveur parle en premier : étape 1 de synchronisation, puis présence
    // connue. Le client répond avec son diff éventuel.
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(syncEncoder, active.doc);
    sendTo(ws, encoding.toUint8Array(syncEncoder));

    const states = active.awareness.getStates();
    if (states.size > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(active.awareness, Array.from(states.keys())),
      );
      sendTo(ws, encoding.toUint8Array(awarenessEncoder));
    }

    return true;
  }

  private onMessage(room: Room, ws: WebSocket, state: ConnectionState, data: RawData): void {
    try {
      const decoder = decoding.createDecoder(toUint8Array(data));
      const messageType = decoding.readVarUint(decoder);
      switch (messageType) {
        case MESSAGE_SYNC: {
          const syncMessageType = decoding.peekVarUint(decoder);
          if (!shouldAcceptUpdate(state.canWrite, syncMessageType)) {
            // Message d'écriture d'un lecteur : refusé, puis fermeture au-delà
            // d'un seuil (un client qui vient de se connecter envoie un
            // syncStep2 vide, toléré comme une tentative).
            state.violations += 1;
            if (state.violations >= MAX_READONLY_VIOLATIONS) {
              closeConnection(ws, CLOSE_READ_ONLY, "Écriture refusée (lecture seule)");
            }
            return;
          }
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          syncProtocol.readSyncMessage(decoder, encoder, room.doc, ws);
          // Longueur > 1 : il y a une réponse (étape 2) en plus du type.
          if (encoding.length(encoder) > 1) {
            sendTo(ws, encoding.toUint8Array(encoder));
          }
          return;
        }
        case MESSAGE_AWARENESS: {
          awarenessProtocol.applyAwarenessUpdate(
            room.awareness,
            decoding.readVarUint8Array(decoder),
            ws,
          );
          return;
        }
        default:
          // Type inconnu : ignoré (compatibilité ascendante du protocole).
          return;
      }
    } catch (error) {
      console.error("COLLAB: message ignoré (contenu invalide)", error);
    }
  }

  private detach(room: Room, ws: WebSocket): void {
    const state = room.conns.get(ws);
    if (!state) return;
    room.conns.delete(ws);
    if (state.pingTimer) clearInterval(state.pingTimer);
    // La présence publiée par cette connexion disparaît avec elle ; les
    // autres clients sont prévenus par l'événement `update` de l'awareness.
    awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(state.awarenessIds), null);
    if (room.conns.size === 0) {
      room.awareness.destroy();
      room.doc.destroy();
      if (this.rooms.get(room.id) === room) this.rooms.delete(room.id);
    }
  }
}

/**
 * Ferme proprement une connexion ; `terminate` en secours si la socket est
 * déjà détruite.
 */
export function closeConnection(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    ws.terminate();
  }
}

function createRoom(id: string): Room {
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  // Le serveur relaie la présence : il ne publie pas la sienne.
  awareness.setLocalState(null);

  const room: Room = { id, doc, awareness, conns: new Map() };

  // Chaque modification appliquée (depuis une connexion écrivaine) est
  // relayée aux autres — la synchronisation d'origine n'envoie rien d'elle-même.
  doc.on("update", (update: Uint8Array, origin: unknown) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);
    for (const conn of room.conns.keys()) {
      if (conn !== origin) sendTo(conn, message);
    }
  });

  awareness.on(
    "update",
    (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const originState = room.conns.get(origin as WebSocket);
      if (originState) {
        for (const clientId of changes.added) originState.awarenessIds.add(clientId);
        for (const clientId of changes.removed) originState.awarenessIds.delete(clientId);
      }
      const changed = [...changes.added, ...changes.updated, ...changes.removed];
      if (changed.length === 0) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
      );
      const message = encoding.toUint8Array(encoder);
      for (const conn of room.conns.keys()) sendTo(conn, message);
    },
  );

  return room;
}

function sendTo(ws: WebSocket, message: Uint8Array): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(message, (error) => {
      if (error) closeConnection(ws, 1011, "Écriture impossible");
    });
  } catch {
    closeConnection(ws, 1011, "Écriture impossible");
  }
}

/** `ws` livre des Buffer, parfois des ArrayBuffer selon le transport. */
function toUint8Array(data: RawData): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return data;
}
