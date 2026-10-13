import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

/** Session de collaboration temps réel attachée à un document Docs. */
export type CollabSession = {
  /** Document Yjs partagé : source de vérité de l'édition collaborative. */
  doc: Y.Doc;
  /** Fournisseur WebSocket : synchronisation et présence de la salle. */
  provider: WebsocketProvider;
  /** Ferme la connexion et libère le document partagé. */
  destroy: () => void;
};

/**
 * Ouvre une session de collaboration sur la salle `room` du serveur `url`,
 * authentifiée par le jeton signé `token` (voir `getCollabTokenFn`).
 *
 * Module sans React, utilisable tel quel côté client : l'appelant décide du
 * cycle de vie (`destroy`) et aucun effet n'est déclenché avant l'appel.
 */
export function createCollabSession(input: {
  url: string;
  room: string;
  token: string;
}): CollabSession {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(input.url, input.room, doc, {
    params: { token: input.token },
    connect: true,
  });

  return {
    doc,
    provider,
    destroy: () => {
      provider.destroy();
      doc.destroy();
    },
  };
}
