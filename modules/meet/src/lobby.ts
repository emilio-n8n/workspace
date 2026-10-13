/**
 * Textes et réglages de la salle d'attente (lobby). Partagés par l'écran
 * préparatoire (qui demande l'entrée) et par la salle de réunion (où
 * l'organisateur admet) — la même terminologie des deux côtés.
 */

// Type importé pour rester aligné sur le service (aucun import à l'exécution).
import type { LobbyStateView } from "./service.ts";

export type { LobbyStateView };

export type LobbyTone = "info" | "success" | "warning" | "danger";

/** Intervalle d'interrogation du statut d'admission. */
export const LOBBY_POLL_MS = 4000;

const TITLES: Record<LobbyStateView, string> = {
  none: "",
  waiting: "En attente d'admission",
  admitted: "Entrée autorisée",
  denied: "Entrée refusée",
};

const MESSAGES: Record<LobbyStateView, string> = {
  none: "",
  waiting: "L'organisateur a été prévenu. Vous entrerez automatiquement dès votre admission.",
  admitted: "Vous pouvez rejoindre la salle.",
  denied: "L'organisateur a refusé votre entrée. Vous pouvez demander à nouveau.",
};

const ACTIONS: Record<LobbyStateView, string> = {
  none: "Demander à entrer",
  waiting: "Patienter…",
  admitted: "Entrer dans la salle",
  denied: "Demander à nouveau",
};

/** Un état neutre vaut toujours `info` (salons sans admission ou organisateur). */
export function lobbyTone(state: LobbyStateView): LobbyTone {
  if (state === "admitted") return "success";
  if (state === "denied") return "danger";
  if (state === "waiting") return "warning";
  return "info";
}

export function lobbyTitle(state: LobbyStateView): string {
  return TITLES[state];
}

export function lobbyMessage(state: LobbyStateView): string {
  return MESSAGES[state];
}

/** Libellé du bouton principal de l'écran préparatoire. */
export function lobbyActionLabel(state: LobbyStateView): string {
  return ACTIONS[state];
}

/** Le bouton principal mène-t-il à la connexion ? (`false` = demander l'entrée) */
export function lobbyActionIsJoin(state: LobbyStateView): boolean {
  return state === "admitted";
}

/** Le statut doit-il être interrogé en boucle ? (requête d'entrée en cours) */
export function lobbyActionIsPending(state: LobbyStateView): boolean {
  return state === "waiting";
}

/** Compte rendu de la file d'attente pour l'organisateur. */
export function waitingAnnouncement(count: number): string {
  if (count <= 0) return "Personne n'attend";
  if (count === 1) return "1 personne attend";
  return `${count} personnes attendent`;
}
