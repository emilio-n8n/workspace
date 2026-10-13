import { messageYjsSyncStep1 } from "y-protocols/sync";

/**
 * Protocole de collaboration : mêmes numéros de message de premier niveau que
 * le serveur de référence y-websocket (`messageSync = 0`,
 * `messageAwareness = 1`).
 */
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;

/**
 * Bornes volontairement basses : cette instance collaborative reste un
 * service d'appoint, pas un cluster. Saturer ferme la connexion (1013) plutôt
 * que de laisser le processus enfler.
 */
export const MAX_ROOMS = 200;
export const MAX_CONNS_PER_ROOM = 30;

/**
 * Tentatives d'écriture refusées avant de fermer une connexion en lecture
 * seule. Une marge existe pour le `syncStep2` (diff vide) qu'un client
 * fraîchement connecté envoie en réponse au `syncStep1` du serveur.
 */
export const MAX_READONLY_VIOLATIONS = 5;

/** Délai maximal sans pong avant de considérer la connexion morte. */
export const PING_TIMEOUT_MS = 30_000;

/** Code de fermeture : jeton invalide, expiré ou lié à un autre document. */
export const CLOSE_INVALID_TOKEN = 4401;
/** Code de fermeture : écriture refusée à une connexion en lecture seule. */
export const CLOSE_READ_ONLY = 4403;
/** Code de fermeture : capacité atteinte (salles ou connexions par salle). */
export const CLOSE_CAPACITY = 1013;

/**
 * Un écrivain peut envoyer n'importe quel message de synchronisation ;
 * un lecteur ne peut que *demander* l'état (`syncStep1`). Les `syncStep2` et
 * `update` entrants sont refusés : ils modifieraient le document partagé.
 */
export function shouldAcceptUpdate(canWrite: boolean, syncMessageType: number): boolean {
  return canWrite || syncMessageType === messageYjsSyncStep1;
}
